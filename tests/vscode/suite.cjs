// @ts-check
// Runs inside the VS Code extension host, against the real extension. Started by tests/vscode/run.mjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const SCHEME = 'synapse-review';
const GREETER = 'def greet(name):\n    """Return a greeting."""\n    return "Hello, " + name\n';

/** @param {() => unknown} predicate @param {string} what */
async function waitFor(predicate, what, timeoutMs = 20_000) {
  const started = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) {
      return value;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/** @template T @param {Thenable<T>} promise @param {string} what @returns {Promise<T>} */
function within(promise, what, timeoutMs = 30_000) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${what}`)), timeoutMs)),
  ]);
}

/** Saves a screenshot of the workbench when SYNAPSE_SCREENSHOTS is set, and does nothing otherwise. */
async function snap(/** @type {string} */ name) {
  const folder = process.env.SYNAPSE_SCREENSHOTS;
  if (!folder) {
    return;
  }
  await new Promise(resolve => setTimeout(resolve, 600));
  const targets = /** @type {{type: string, url: string, webSocketDebuggerUrl: string}[]} */ (await (await fetch('http://127.0.0.1:9339/json/list')).json());
  const page = targets.find(target => target.type === 'page' && target.url.includes('workbench'));
  if (!page) {
    return;
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  const data = await new Promise(resolve => {
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id === 1) {
        resolve(message.result.data);
      }
    });
    socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
  });
  socket.close();
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${name}.png`), Buffer.from(/** @type {string} */ (data), 'base64'));
}

async function run() {
  const root = /** @type {string} */ (process.env.SYNAPSE_TEST_WORKSPACE);
  const read = (/** @type {string} */ file) => (fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : undefined);
  const extension = vscode.extensions.getExtension('synapse-team.synapse-agent');
  assert.ok(extension, 'the extension is installed in the development host');
  const api = await extension.activate();

  let lastReview = '';
  /** Waits for a new review editor, so each proposal is seen once. */
  const nextReview = async () => {
    const editor = await waitFor(() => {
      const active = vscode.window.activeTextEditor;
      return active && active.document.uri.scheme === SCHEME && active.document.uri.toString() !== lastReview ? active : undefined;
    }, 'a review editor to open');
    lastReview = editor.document.uri.toString();
    return editor;
  };
  const lensTitles = async (/** @type {vscode.Uri} */ uri) =>
    /** @type {vscode.CodeLens[]} */ (await vscode.commands.executeCommand('vscode.executeCodeLensProvider', uri)).map(lens => lens.command?.title ?? '');
  const sent = () => /** @type {{type: string, event?: any, ledger?: any, text?: string}[]} */ (api.panel.sent);
  const statuses = () => sent().filter(message => message.type === 'run-event' && message.event.type === 'status').map(message => message.event.status);
  const notices = () => sent().filter(message => message.type === 'notice').map(message => message.text ?? '');
  const runEvents = (/** @type {string} */ type) => sent().filter(message => message.type === 'run-event' && message.event.type === type).map(message => message.event);
  /** Answers the "Run this command?" prompt the way the Run button does. */
  const approveCommand = async () => {
    const answer = await waitFor(() => /** @type {any} */ (api.reviewUi).pendingConfirm, 'the command approval prompt');
    answer(true);
  };
  const reviewTabsOpen = () =>
    vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === SCHEME);

  async function selectGreeter() {
    const document = await vscode.workspace.openTextDocument(path.join(root, 'src/greeter.py'));
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 2, document.lineAt(2).text.length);
  }

  /** @type {[string, () => Promise<void>][]} */
  const tests = [
    [
      'activates, registers its commands and resolves the panel',
      async () => {
        const commands = await vscode.commands.getCommands(true);
        for (const id of ['synapse.inlineEdit', 'synapse.cancel', 'synapse.undoLast', 'synapse.undoRun', 'synapse.checkSetup', 'synapse.review.acceptHunk']) {
          assert.ok(commands.includes(id), `${id} is registered`);
        }
        await vscode.commands.executeCommand('workbench.view.extension.synapse');
        await waitFor(() => /** @type {any} */ (api.panel).view, 'the agent panel to resolve');
      },
    ],
    [
      'check setup confirms TrueForge, the editor MCP server and the model',
      async () => {
        await within(vscode.commands.executeCommand('synapse.checkSetup'), 'check setup');
        const lines = notices();
        assert.ok(lines.some(text => text.startsWith('✓ TrueForge is running')), lines.join('\n'));
        assert.ok(lines.some(text => text.startsWith("✓ TrueForge can reach the editor's MCP server")), lines.join('\n'));
        assert.ok(lines.some(text => text.startsWith('✓ Model vsc-live/mock is configured')), lines.join('\n'));
      },
    ],
    [
      'inline edit opens a per-hunk review, writes nothing until accepted, then applies it (A1, B2)',
      async () => {
        await selectGreeter();
        const finished = vscode.commands.executeCommand('synapse.inlineEdit', 'Add a comment');
        const review = await nextReview();
        const titles = await lensTitles(review.document.uri);
        assert.ok(titles.includes('Accept (Alt+Y)') && titles.includes('Reject (Alt+N)'), titles.join(' | '));
        assert.ok(titles.some(title => title.startsWith('Hunk 1 of 1')), titles.join(' | '));
        assert.equal(path.posix.basename(review.document.uri.path), 'Review · greeter.py', 'the tab is distinct from the real file');
        assert.equal(review.document.languageId, 'python', 'the review keeps syntax highlighting');
        assert.ok(review.document.getText().includes('# Edited by the mock model'), 'the review shows the proposal');
        await snap('1-inline-review');
        assert.equal(read('src/greeter.py'), GREETER, 'nothing is written during review');
        await vscode.commands.executeCommand('synapse.review.acceptHunk', 1);
        await within(finished, 'the run to finish');
        assert.ok(read('src/greeter.py')?.endsWith('# Edited by the mock model\n'), read('src/greeter.py'));
        await waitFor(() => !reviewTabsOpen(), 'the review tab to close');
      },
    ],
    [
      'undo last change restores the file (B2)',
      async () => {
        await vscode.commands.executeCommand('synapse.undoLast');
        await waitFor(() => read('src/greeter.py') === GREETER, 'the file to be restored');
      },
    ],
    [
      'agent mode reviews three files, asks before a command, shows the context ledger, and undo run reverts it all (A2, B1, B2)',
      async () => {
        const before = sent().length;
        const finished = api.controller.startAgentRun('E2E_AGENT server=synapse-editor');
        for (let index = 0; index < 3; index += 1) {
          await nextReview();
          if (index === 0) {
            await snap('2-agent-review');
          }
          await vscode.commands.executeCommand('synapse.review.acceptAll');
        }
        await approveCommand();
        await within(finished, 'the run to finish');
        await vscode.commands.executeCommand('workbench.view.extension.synapse');
        await snap('3-agent-panel-after-run');
        assert.ok(read('src/greeter.py')?.includes('return f"Hello, {name}!"'));
        assert.ok(read('tests/test_greeter.py')?.includes('"Hello, Ada!"'));
        assert.ok(read('docs/greeting.md')?.includes('# Greeting'));
        assert.ok(runEvents('tool-result').some(event => event.content.includes('tests-pass')), 'the approved command ran');
        const ledger = sent().slice(before).find(message => message.type === 'ledger')?.ledger;
        assert.ok(ledger && ledger.entries.length > 0 && ledger.usedTokens <= ledger.budgetTokens, JSON.stringify(ledger));
        assert.equal(statuses().at(-1), 'done');

        await vscode.commands.executeCommand('synapse.undoRun');
        await waitFor(() => read('src/greeter.py') === GREETER && read('docs/greeting.md') === undefined, 'the whole run to be undone');
        assert.ok(read('tests/test_greeter.py')?.includes('"Hello, Ada"'));
      },
    ],
    [
      'stop during a run restores files it already changed (A3)',
      async () => {
        const finished = api.controller.startAgentRun('E2E_SLOW server=synapse-editor');
        await nextReview();
        await vscode.commands.executeCommand('synapse.review.acceptAll');
        await waitFor(() => read('src/greeter.py')?.includes('Hi, '), 'the accepted edit to land');
        const tokens = () => sent().filter(message => message.type === 'run-event' && message.event.type === 'token').length;
        const seen = tokens();
        await waitFor(() => tokens() > seen + 2, 'tokens to stream');
        const stopped = Date.now();
        await vscode.commands.executeCommand('synapse.cancel');
        await within(finished, 'the run to finish');
        await snap('4-after-stop');
        assert.ok(Date.now() - stopped < 3000, 'stop is immediate');
        assert.equal(read('src/greeter.py'), GREETER);
        assert.equal(statuses().at(-1), 'cancelled');
      },
    ],
    [
      'closing the review tab abandons the proposal without writing',
      async () => {
        await selectGreeter();
        const finished = vscode.commands.executeCommand('synapse.inlineEdit', 'Add a comment');
        await nextReview();
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await within(finished, 'the run to finish');
        assert.equal(read('src/greeter.py'), GREETER);
      },
    ],
    [
      'a broken primary model falls back automatically, and rejecting leaves the file unchanged (Task C, B3)',
      async () => {
        await vscode.workspace.getConfiguration('synapse').update('models', ['vsc-dead/mock', 'vsc-live/mock'], vscode.ConfigurationTarget.Workspace);
        try {
          await selectGreeter();
          const finished = vscode.commands.executeCommand('synapse.inlineEdit', 'Add a comment');
          await nextReview();
          await vscode.commands.executeCommand('synapse.review.rejectAll');
          await within(finished, 'the run to finish');
          assert.ok(runEvents('model-switch').some(event => event.from === 'vsc-dead/mock' && event.to === 'vsc-live/mock'), 'the run switched model');
          assert.equal(read('src/greeter.py'), GREETER);
        } finally {
          await vscode.workspace.getConfiguration('synapse').update('models', ['vsc-live/mock'], vscode.ConfigurationTarget.Workspace);
        }
      },
    ],
    [
      'with every model down, the user gets a clear message and nothing changes (Task C, B3)',
      async () => {
        await vscode.workspace.getConfiguration('synapse').update('models', ['vsc-dead/mock'], vscode.ConfigurationTarget.Workspace);
        try {
          await selectGreeter();
          await within(vscode.commands.executeCommand('synapse.inlineEdit', 'Add a comment'), 'the run to fail');
          await snap('5-total-failure');
          assert.ok(
            notices().some(text => text === 'Synapse could not finish. Could not reach the model vsc-dead/mock. Check that the endpoint configured in TrueForge is running. Your files were not changed.'),
            notices().join('\n'),
          );
          assert.equal(read('src/greeter.py'), GREETER);
        } finally {
          await vscode.workspace.getConfiguration('synapse').update('models', ['vsc-live/mock'], vscode.ConfigurationTarget.Workspace);
        }
      },
    ],
  ];

  const failures = [];
  for (const [name, body] of tests) {
    console.log(`START ${name}`);
    try {
      await body();
      console.log(`PASS  ${name}`);
    } catch (error) {
      failures.push(name);
      console.log(`FAIL  ${name}\n${error instanceof Error ? error.stack : String(error)}`);
      await vscode.commands.executeCommand('synapse.cancel');
    }
  }
  console.log(`\n${tests.length - failures.length} passed, ${failures.length} failed in VS Code ${vscode.version}`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} extension test(s) failed`);
  }
}

module.exports = { run };
