import * as vscode from 'vscode';
import coder from '../../agent/definitions/coder.json';
import inlineEdit from '../../agent/definitions/inline-edit.json';
import { AgentDefinitionSchema } from './core/agentDefinition';
import { RunController } from './editor/controller';
import { AgentPanel } from './editor/panel';
import { EditorReviewUi } from './editor/reviewUi';

/** What `activate` hands to extension tests. Nothing in the extension itself depends on it. */
export interface SynapseTestApi {
  controller: RunController;
  reviewUi: EditorReviewUi;
  panel: AgentPanel;
}

export function activate(context: vscode.ExtensionContext): SynapseTestApi {
  const definitions = {
    coder: AgentDefinitionSchema.parse(coder),
    inlineEdit: AgentDefinitionSchema.parse(inlineEdit),
  };
  const reviewUi = new EditorReviewUi();
  const panel = new AgentPanel(context.extensionUri, request => {
    controller.handlePanelRequest(request);
  });
  const controller = new RunController(panel, reviewUi, definitions);

  context.subscriptions.push(
    reviewUi,
    controller,
    vscode.window.registerWebviewViewProvider('synapse.panel', panel, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('synapse.inlineEdit', (instruction?: unknown) =>
      controller.startInlineRun(typeof instruction === 'string' ? instruction : undefined),
    ),
    vscode.commands.registerCommand('synapse.cancel', () => controller.cancel()),
    vscode.commands.registerCommand('synapse.undoLast', () => controller.undoLast()),
    vscode.commands.registerCommand('synapse.undoRun', () => controller.undoRun()),
    vscode.commands.registerCommand('synapse.checkSetup', () => controller.checkSetup()),
  );
  void controller.activate();
  return { controller, reviewUi, panel };
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}
