import * as vscode from 'vscode';
import type { ReviewSession } from '../core/hunks';
import type { ReviewUi } from '../core/review';

export const REVIEW_SCHEME = 'synapse-review';

interface ActiveReview {
  session: ReviewSession;
  uri: vscode.Uri;
  rationale: string;
  position: { index: number; total: number };
  finish: (completed: boolean) => void;
}

const line = (start: number, end: number): vscode.Range[] => {
  const ranges: vscode.Range[] = [];
  for (let index = start; index < end; index += 1) {
    ranges.push(new vscode.Range(index, 0, index, 0));
  }
  return ranges;
};

const decorationFor = (background: string, label: string, dim = false): vscode.TextEditorDecorationType =>
  vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor(background),
    ...(dim ? { opacity: '0.45', textDecoration: 'line-through' } : {}),
    // Colour alone does not tell removed from added, so every changed line also says which it is.
    after: { contentText: `   ${label}`, color: new vscode.ThemeColor('editorCodeLens.foreground') },
  });

/**
 * Renders a proposal as a read-only editor with Accept and Reject on every hunk. Nothing here writes
 * to the workspace: it only records decisions, and the tool applies them after the turn resumes.
 */
export class EditorReviewUi implements ReviewUi, vscode.TextDocumentContentProvider, vscode.CodeLensProvider, vscode.Disposable {
  private active: ActiveReview | undefined;
  private pendingConfirm: ((approved: boolean) => void) | undefined;
  private sequence = 0;
  private readonly lensChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensChanged.event;
  private readonly decorations = {
    removed: decorationFor('diffEditor.removedLineBackground', '− removed'),
    added: decorationFor('diffEditor.insertedLineBackground', '+ added'),
    discarded: decorationFor('editor.inactiveSelectionBackground', 'will not apply', true),
  };
  private readonly subscriptions: vscode.Disposable[];

  constructor() {
    this.subscriptions = [
      vscode.workspace.registerTextDocumentContentProvider(REVIEW_SCHEME, this),
      vscode.languages.registerCodeLensProvider({ scheme: REVIEW_SCHEME }, this),
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.decorate();
      }),
      vscode.window.tabGroups.onDidChangeTabs(event => {
        if (this.active && event.closed.some(tab => this.isReviewTab(tab))) {
          this.complete(false);
        }
      }),
      vscode.commands.registerCommand('synapse.review.acceptHunk', (hunkId?: number) => {
        this.decide('accepted', hunkId);
      }),
      vscode.commands.registerCommand('synapse.review.rejectHunk', (hunkId?: number) => {
        this.decide('rejected', hunkId);
      }),
      vscode.commands.registerCommand('synapse.review.acceptAll', () => {
        this.decideAll('accepted');
      }),
      vscode.commands.registerCommand('synapse.review.rejectAll', () => {
        this.decideAll('rejected');
      }),
      vscode.commands.registerCommand('synapse.review.nextHunk', () => {
        this.moveCursor(1);
      }),
      vscode.commands.registerCommand('synapse.review.previousHunk', () => {
        this.moveCursor(-1);
      }),
    ];
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.active?.uri.toString() === uri.toString() ? this.active.session.document.text : '';
  }

  async reviewHunks(session: ReviewSession, rationale: string, position: { index: number; total: number }): Promise<boolean> {
    if (session.hunks.length === 0) {
      return true;
    }
    this.sequence += 1;
    const uri = vscode.Uri.from({ scheme: REVIEW_SCHEME, path: `/${session.path}`, query: String(this.sequence) });
    const completed = new Promise<boolean>(resolve => {
      this.active = { session, uri, rationale, position, finish: resolve };
    });
    await vscode.commands.executeCommand('setContext', 'synapse.reviewing', true);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const first = session.document.ranges[0];
    if (first) {
      editor.revealRange(new vscode.Range(first.removedStart, 0, first.addedEnd, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      editor.selection = new vscode.Selection(first.removedStart, 0, first.removedStart, 0);
    }
    this.decorate();
    this.lensChanged.fire();
    return completed;
  }

  async confirmCommand(command: string, rationale: string): Promise<boolean> {
    const decision = new Promise<boolean>(resolve => {
      this.pendingConfirm = resolve;
    });
    const asked = vscode.window
      .showWarningMessage(`Run this command? ${command}${rationale ? ` (${rationale})` : ''}`, 'Run', 'Do Not Run')
      .then(choice => choice === 'Run');
    const approved = await Promise.race([decision, asked]);
    this.pendingConfirm = undefined;
    return approved;
  }

  closeAll(): void {
    this.pendingConfirm?.(false);
    this.pendingConfirm = undefined;
    this.complete(false);
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const active = this.active;
    if (active?.uri.toString() !== document.uri.toString()) {
      return [];
    }
    const { session, position } = active;
    const top = new vscode.Range(0, 0, 0, 0);
    const reason = active.rationale ? `: ${active.rationale}` : '';
    const lenses = [
      new vscode.CodeLens(top, { title: `Proposal ${String(position.index)} of ${String(position.total)} for ${session.path}${reason}`, command: '' }),
      new vscode.CodeLens(top, { title: 'Accept all', command: 'synapse.review.acceptAll' }),
      new vscode.CodeLens(top, { title: 'Reject all', command: 'synapse.review.rejectAll' }),
    ];
    for (const range of session.document.ranges) {
      const hunk = session.hunks.find(candidate => candidate.id === range.hunkId);
      if (!hunk) {
        continue;
      }
      const at = new vscode.Range(range.removedStart, 0, range.removedStart, 0);
      const summary = `Hunk ${String(hunk.id)} of ${String(session.hunks.length)}: removes ${String(hunk.removed.length)}, adds ${String(hunk.added.length)}`;
      const decision = session.decisionFor(hunk.id);
      lenses.push(new vscode.CodeLens(at, { title: summary, command: '' }));
      if (decision === 'pending') {
        lenses.push(
          new vscode.CodeLens(at, { title: 'Accept (Alt+Y)', command: 'synapse.review.acceptHunk', arguments: [hunk.id] }),
          new vscode.CodeLens(at, { title: 'Reject (Alt+N)', command: 'synapse.review.rejectHunk', arguments: [hunk.id] }),
        );
      } else {
        lenses.push(new vscode.CodeLens(at, { title: decision === 'accepted' ? '✓ Accepted' : '✗ Rejected', command: '' }));
      }
    }
    return lenses;
  }

  private isReviewTab(tab: vscode.Tab): boolean {
    return tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === this.active?.uri.toString();
  }

  private decide(decision: 'accepted' | 'rejected', hunkId?: number): void {
    const active = this.active;
    if (!active) {
      return;
    }
    const cursor = vscode.window.activeTextEditor?.selection.active.line ?? 0;
    const target = hunkId ?? active.session.hunkAtOrAfter(cursor);
    if (target === undefined) {
      return;
    }
    active.session.decide(target, decision);
    this.afterDecision();
  }

  private decideAll(decision: 'accepted' | 'rejected'): void {
    this.active?.session.decideRemaining(decision);
    this.afterDecision();
  }

  private afterDecision(): void {
    const active = this.active;
    if (!active) {
      return;
    }
    if (active.session.isComplete) {
      this.complete(true);
      return;
    }
    this.decorate();
    this.lensChanged.fire();
    const nextPending = active.session.hunks.find(hunk => active.session.decisionFor(hunk.id) === 'pending');
    const range = active.session.document.ranges.find(candidate => candidate.hunkId === nextPending?.id);
    if (range) {
      this.reveal(range.removedStart);
    }
  }

  private moveCursor(direction: 1 | -1): void {
    const active = this.active;
    const cursor = vscode.window.activeTextEditor?.selection.active.line ?? 0;
    if (!active) {
      return;
    }
    const ranges = active.session.document.ranges;
    const target =
      direction === 1 ? ranges.find(range => range.removedStart > cursor) : [...ranges].reverse().find(range => range.removedStart < cursor);
    if (target) {
      this.reveal(target.removedStart);
    }
  }

  private reveal(lineNumber: number): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.selection = new vscode.Selection(lineNumber, 0, lineNumber, 0);
      editor.revealRange(new vscode.Range(lineNumber, 0, lineNumber, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  private decorate(): void {
    const active = this.active;
    if (!active) {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== active.uri.toString()) {
        continue;
      }
      const removed: vscode.Range[] = [];
      const added: vscode.Range[] = [];
      const discarded: vscode.Range[] = [];
      for (const range of active.session.document.ranges) {
        const decision = active.session.decisionFor(range.hunkId);
        (decision === 'accepted' ? discarded : removed).push(...line(range.removedStart, range.removedEnd));
        (decision === 'rejected' ? discarded : added).push(...line(range.addedStart, range.addedEnd));
      }
      editor.setDecorations(this.decorations.removed, removed);
      editor.setDecorations(this.decorations.added, added);
      editor.setDecorations(this.decorations.discarded, discarded);
    }
  }

  private complete(completed: boolean): void {
    const active = this.active;
    if (!active) {
      return;
    }
    this.active = undefined;
    void vscode.commands.executeCommand('setContext', 'synapse.reviewing', false);
    active.finish(completed);
    const tabs = vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === active.uri.toString());
    void vscode.window.tabGroups.close(tabs);
    this.lensChanged.fire();
  }

  dispose(): void {
    this.closeAll();
    this.lensChanged.dispose();
    for (const decoration of Object.values(this.decorations)) {
      decoration.dispose();
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }
}
