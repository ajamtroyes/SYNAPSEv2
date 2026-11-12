import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import * as vscode from 'vscode';
import type { AgentDefinition } from '../core/agentDefinition';
import { AgentRun, type RunEvent, type RunResult } from '../core/agentRun';
import { ApprovalGate } from '../core/approvalGate';
import { CommandRunner } from '../core/commandRunner';
import { EditJournal, type UndoReport } from '../core/journal';
import { assembleMessage, buildLedger, parseMentions, resolveMentions } from '../core/mentions';
import { isSensitivePath } from '../core/paths';
import { retrieve } from '../core/retrieval';
import { ReviewCoordinator } from '../core/review';
import { createTools } from '../mcp/tools';
import { type RunningMcpServer, startMcpServer } from '../mcp/server';
import { TrueForgeGateway } from '../trueforge/gateway';
import { checkSetup, createClient, registerMcpServer } from '../trueforge/setup';
import type { AgentPanel, PanelRequest } from './panel';
import type { EditorReviewUi } from './reviewUi';
import { VscodeWorkspace } from './workspace';

interface Settings {
  baseUrl: string;
  models: string[];
  attemptsPerModel: number;
  backoffMs: number;
  budgetTokens: number;
}

function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration('synapse');
  return {
    baseUrl: config.get('trueforgeUrl', 'http://localhost:8790'),
    models: config.get<string[]>('models', []),
    attemptsPerModel: config.get('retry.attemptsPerModel', 2),
    backoffMs: config.get('retry.backoffMs', 1000),
    budgetTokens: config.get('context.budgetTokens', 8000),
  };
}

function venvBinDirectories(root: string): string[] {
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin';
  return ['.venv', 'venv'].map(name => join(root, name, bin)).filter(path => existsSync(path));
}

/** Wires the editor to the run. All decisions live in `core`; this file only connects things. */
export class RunController implements vscode.Disposable {
  private readonly gate = new ApprovalGate();
  private readonly commands = new CommandRunner();
  private readonly statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private journal: EditJournal | undefined;
  private workspace: VscodeWorkspace | undefined;
  private mcp: RunningMcpServer | undefined;
  private registeredFor: string | undefined;
  private current: { id: string; run: AgentRun } | undefined;
  private lastSessionId: string | undefined;
  private busy = false;

  constructor(
    private readonly panel: AgentPanel,
    private readonly reviewUi: EditorReviewUi,
    private readonly definitions: { coder: AgentDefinition; inlineEdit: AgentDefinition },
  ) {
    this.statusBar.command = 'synapse.cancel';
  }

  /** Starts the MCP server and registers it, without failing activation if TrueForge is not up yet. */
  async activate(): Promise<void> {
    if (!this.ensureWorkspace()) {
      return;
    }
    try {
      await this.ensureConnected();
    } catch {
      // Reported properly when the user starts a run or runs "Check TrueForge Setup".
    }
  }

  private ensureWorkspace(): VscodeWorkspace | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    if (!this.workspace) {
      this.workspace = new VscodeWorkspace(folder);
      this.journal = new EditJournal(this.workspace);
    }
    return this.workspace;
  }

  private async ensureConnected(): Promise<TrueForge> {
    const workspace = this.workspace;
    const journal = this.journal;
    if (!workspace || !journal) {
      throw new Error('Open a folder first: the agent works on the current workspace.');
    }
    const { baseUrl } = readSettings();
    const client = createClient(baseUrl);
    this.mcp ??= await startMcpServer(
      createTools({
        ws: workspace,
        gate: this.gate,
        journal,
        runId: () => this.current?.id,
        runCommand: command => this.commands.run(command, { cwd: workspace.root, pathPrepend: venvBinDirectories(workspace.root) }),
        onRetrieval: result => {
          this.panel.post({ type: 'ledger', ledger: buildLedger({ resolved: [], unresolved: [], usedTokens: 0 }, result, result.budgetTokens) });
        },
      }),
    );
    if (this.registeredFor !== baseUrl) {
      await registerMcpServer(client, this.mcp.url, this.mcp.token);
      this.registeredFor = baseUrl;
    }
    return client;
  }

  /** Reports problems here, so a failure before the run starts is still a clear message. */
  private async prepare(): Promise<{ client: TrueForge; settings: Settings; workspace: VscodeWorkspace; journal: EditJournal } | undefined> {
    const settings = readSettings();
    const workspace = this.ensureWorkspace();
    if (!workspace || !this.journal) {
      void vscode.window.showErrorMessage('Open a folder first: the agent works on the current workspace.');
      return undefined;
    }
    if (settings.models.length === 0) {
      void vscode.window.showErrorMessage('Choose a model first: set "synapse.models" to the models configured in TrueForge.');
      return undefined;
    }
    try {
      return { client: await this.ensureConnected(), settings, workspace, journal: this.journal };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Cannot reach TrueForge at ${settings.baseUrl} (${detail}). Start it with: npm run trueforge`);
      return undefined;
    }
  }

  /** Claimed before any await, so a double submit cannot start two runs on one workspace. */
  private async exclusive(work: () => Promise<void>): Promise<void> {
    if (this.busy) {
      void vscode.window.showWarningMessage('A run is in progress. Stop it first.');
      return;
    }
    this.busy = true;
    try {
      await work();
    } catch (error) {
      void vscode.window.showErrorMessage(`Synapse could not start: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
    }
  }

  startAgentRun(text: string): Promise<void> {
    return this.exclusive(async () => {
      const ready = await this.prepare();
      if (!ready) {
        return;
      }
      const { client, settings, workspace, journal } = ready;
      this.panel.post({ type: 'user-message', text });
      const mentions = await resolveMentions(workspace, parseMentions(text), settings.budgetTokens);
      const retrieval = await retrieve(
        { listFiles: () => workspace.listFiles(), read: path => workspace.read(path) },
        text,
        {
          budgetTokens: Math.max(settings.budgetTokens - mentions.usedTokens, 0),
          excludePaths: new Set(mentions.resolved.filter(item => item.kind === 'file').map(item => item.path)),
        },
      );
      this.panel.post({ type: 'ledger', ledger: buildLedger(mentions, retrieval, settings.budgetTokens) });
      await this.launch(client, settings, journal, workspace, this.definitions.coder, assembleMessage(text, mentions, retrieval));
    });
  }

  async startInlineRun(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage('Select the code you want to change first.');
      return;
    }
    const selection = editor.selection;
    const selected = editor.document.getText(selection);
    const path = vscode.workspace.asRelativePath(editor.document.uri, false).split('\\').join('/');
    if (isSensitivePath(path)) {
      void vscode.window.showErrorMessage(`${path} may hold secrets, so it is not sent to a model.`);
      return;
    }
    const instruction = await vscode.window.showInputBox({
      title: `Edit selection in ${path}`,
      prompt: 'Describe the change in plain language.',
      ignoreFocusOut: true,
    });
    if (!instruction) {
      return;
    }
    await this.exclusive(async () => {
      const ready = await this.prepare();
      if (!ready) {
        return;
      }
      const { client, settings, workspace, journal } = ready;
      this.panel.post({ type: 'user-message', text: `Inline edit of ${path}: ${instruction}` });
      const message = [
        `<task>\n${instruction}\n</task>`,
        `<selection path="${path}" lines="${String(selection.start.line + 1)}-${String(selection.end.line + 1)}">\n${selected}\n</selection>`,
      ].join('\n\n');
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Synapse: editing ${path}`, cancellable: true },
        (_progress, token) => {
          token.onCancellationRequested(() => {
            void this.cancel();
          });
          return this.launch(client, settings, journal, workspace, this.definitions.inlineEdit, message);
        },
      );
    });
  }

  private async launch(
    client: TrueForge,
    settings: Settings,
    journal: EditJournal,
    workspace: VscodeWorkspace,
    definition: AgentDefinition,
    message: string,
  ): Promise<void> {
    const id = randomUUID();
    const run = new AgentRun({
      runId: id,
      gateway: new TrueForgeGateway(client.sessions, definition),
      review: new ReviewCoordinator({ root: workspace.root, files: workspace, gate: this.gate, ui: this.reviewUi }),
      closeReviews: () => {
        this.reviewUi.closeAll();
      },
      abortCommands: () => {
        this.commands.abortAll();
      },
      journal,
      gate: this.gate,
      fallback: { models: settings.models, attemptsPerModel: settings.attemptsPerModel, backoffMs: settings.backoffMs },
      onEvent: event => {
        this.onRunEvent(event);
      },
    });
    this.current = { id, run };
    await vscode.commands.executeCommand('setContext', 'synapse.running', true);
    this.statusBar.text = '$(sync~spin) Synapse: running (click to stop)';
    this.statusBar.tooltip = 'Stop the current run';
    this.statusBar.show();
    let result: RunResult;
    try {
      result = await run.start(message);
    } finally {
      this.current = undefined;
      this.statusBar.hide();
      await vscode.commands.executeCommand('setContext', 'synapse.running', false);
    }
    this.reportResult(result);
  }

  private onRunEvent(event: RunEvent): void {
    this.panel.post({ type: 'run-event', event });
    if (event.type === 'session') {
      this.lastSessionId = event.sessionId;
    }
    if (event.type === 'model-switch') {
      void vscode.window.showInformationMessage(`Synapse: ${event.from} failed, continuing with ${event.to}.`);
    }
  }

  private reportResult(result: RunResult): void {
    switch (result.status) {
      case 'done':
        if (result.changedPaths.length > 0) {
          this.panel.post({ type: 'notice', text: `Changed: ${result.changedPaths.join(', ')}` });
        }
        break;
      case 'cancelled':
        break;
      case 'failed':
        void vscode.window.showErrorMessage(`Synapse could not finish: ${result.message}. The workspace was left unchanged.`);
        break;
    }
  }

  async cancel(): Promise<void> {
    await this.current?.run.cancel();
  }

  async undoLast(): Promise<void> {
    this.reportUndo(await this.journal?.undoLast());
  }

  async undoRun(): Promise<void> {
    const runId = this.journal?.lastRunId();
    if (runId) {
      this.reportUndo(await this.journal?.rollbackRun(runId));
    } else {
      this.reportUndo(undefined);
    }
  }

  private reportUndo(report: UndoReport | undefined): void {
    if (!report || (report.restored.length === 0 && report.conflicts.length === 0)) {
      void vscode.window.showInformationMessage('Synapse: there is nothing to undo.');
      return;
    }
    if (report.restored.length > 0) {
      const text = `Undid changes to ${report.restored.join(', ')}.`;
      this.panel.post({ type: 'notice', text });
      void vscode.window.showInformationMessage(`Synapse: ${text}`);
    }
    if (report.conflicts.length > 0) {
      void vscode.window.showWarningMessage(`Synapse left ${report.conflicts.join(', ')} alone because it changed after the agent edited it.`);
    }
  }

  async checkSetup(): Promise<void> {
    const settings = readSettings();
    if (!this.ensureWorkspace()) {
      void vscode.window.showErrorMessage('Open a folder first: the agent works on the current workspace.');
      return;
    }
    let client = createClient(settings.baseUrl);
    try {
      this.registeredFor = undefined;
      client = await this.ensureConnected();
    } catch {
      // checkSetup explains this below, in terms of what to do about it.
    }
    const report = await checkSetup(client, settings.baseUrl, settings.models);
    for (const line of report.lines) {
      this.panel.post({ type: 'notice', text: line });
    }
    const show = report.ok ? vscode.window.showInformationMessage : vscode.window.showErrorMessage;
    void show(report.ok ? 'Synapse setup looks good.' : `Synapse setup has problems: ${report.lines.filter(line => line.startsWith('✗')).join(' ')}`);
  }

  handlePanelRequest(request: PanelRequest): void {
    switch (request.type) {
      case 'submit':
        void this.startAgentRun(request.text);
        break;
      case 'cancel':
        void this.cancel();
        break;
      case 'undoLast':
        void this.undoLast();
        break;
      case 'undoRun':
        void this.undoRun();
        break;
      case 'openSession':
        if (this.lastSessionId) {
          void vscode.env.clipboard.writeText(this.lastSessionId);
          void vscode.window.showInformationMessage(`Session ID copied. Find it under Sessions at ${readSettings().baseUrl}`);
        } else {
          void vscode.window.showInformationMessage('No session yet: start a run first.');
        }
        break;
      case 'mentionQuery':
        void this.answerMentionQuery(request.query);
        break;
    }
  }

  private async answerMentionQuery(query: string): Promise<void> {
    const workspace = this.ensureWorkspace();
    if (!workspace) {
      return;
    }
    const needle = query.toLowerCase();
    const files = (await workspace.listFiles())
      .filter(path => !isSensitivePath(path) && path.toLowerCase().includes(needle))
      .slice(0, 8)
      .map(path => ({ label: path, detail: 'file' }));
    const symbols =
      query.length >= 3 ? (await workspace.findSymbols(query)).slice(0, 5).map(hit => ({ label: hit.name, detail: `${hit.kind ?? 'symbol'} in ${hit.path}` })) : [];
    this.panel.post({ type: 'mention-results', query, results: [...files, ...symbols] });
  }

  dispose(): void {
    void this.current?.run.cancel();
    void this.mcp?.close();
    this.statusBar.dispose();
  }
}
