import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { RunEvent } from '../core/agentRun';
import type { ContextLedger } from '../core/mentions';

export type PanelRequest =
  | { type: 'submit'; text: string }
  | { type: 'cancel' }
  | { type: 'undoLast' }
  | { type: 'undoRun' }
  | { type: 'openSession' }
  | { type: 'mentionQuery'; query: string };

export type PanelMessage =
  | { type: 'run-event'; event: RunEvent }
  | { type: 'ledger'; ledger: ContextLedger }
  | { type: 'retrieval'; ledger: ContextLedger }
  | { type: 'user-message'; text: string }
  | { type: 'notice'; text: string; tone?: 'error' }
  | { type: 'mention-results'; query: string; results: { label: string; detail: string }[] };

/** The agent panel. Holds no run state of its own, so reloading the webview loses nothing important. */
export class AgentPanel implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private backlog: PanelMessage[] = [];
  /** Every message sent, so extension tests can see what the panel was told. */
  readonly sent: PanelMessage[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onRequest: (request: PanelRequest) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((request: PanelRequest) => {
      this.onRequest(request);
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
    for (const message of this.backlog.splice(0)) {
      void view.webview.postMessage(message);
    }
  }

  post(message: PanelMessage): void {
    this.sent.push(message);
    if (this.view) {
      void this.view.webview.postMessage(message);
    } else {
      this.backlog.push(message);
    }
  }

  private html(webview: vscode.Webview): string {
    const asset = (name: string): vscode.Uri => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
    const nonce = randomBytes(16).toString('hex');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${asset('panel.css').toString()}">
  <title>Synapse Agent</title>
</head>
<body>
  <main class="layout">
    <div id="status" class="status" role="status" aria-live="polite">Ready</div>
    <section id="ledger" class="ledger" aria-label="Context chosen for this run" hidden></section>
    <div id="log" class="log" role="log" aria-live="polite" aria-relevant="additions" tabindex="0" aria-label="Agent activity"></div>
    <div class="actions" role="group" aria-label="Changes from the agent">
      <button id="undo-last" type="button" class="secondary">Undo last change</button>
      <button id="undo-run" type="button" class="secondary">Undo last run</button>
      <button id="open-session" type="button" class="secondary">Open session in TrueForge</button>
    </div>
    <form id="composer" class="composer">
      <label for="prompt">Ask the agent. Use @ to mention a file or symbol.</label>
      <ul id="mentions" class="mentions" role="listbox" aria-label="Mention suggestions" hidden></ul>
      <textarea id="prompt" rows="4" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="mentions"
        placeholder="Describe the change. You do not need to name the files."></textarea>
      <div class="composer-row">
        <span class="hint">Enter to send, Shift+Enter for a new line</span>
        <button id="send" type="submit">Send</button>
        <button id="stop" type="button" class="danger" hidden>Stop</button>
      </div>
    </form>
  </main>
  <script nonce="${nonce}" src="${asset('panel.js').toString()}"></script>
</body>
</html>`;
  }
}
