import * as vscode from 'vscode';
import coder from '../../agent/definitions/coder.json';
import inlineEdit from '../../agent/definitions/inline-edit.json';
import { AgentDefinitionSchema } from './core/agentDefinition';
import { RunController } from './editor/controller';
import { AgentPanel } from './editor/panel';
import { EditorReviewUi } from './editor/reviewUi';

export function activate(context: vscode.ExtensionContext): void {
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
    vscode.commands.registerCommand('synapse.inlineEdit', () => controller.startInlineRun()),
    vscode.commands.registerCommand('synapse.cancel', () => controller.cancel()),
    vscode.commands.registerCommand('synapse.undoLast', () => controller.undoLast()),
    vscode.commands.registerCommand('synapse.undoRun', () => controller.undoRun()),
    vscode.commands.registerCommand('synapse.checkSetup', () => controller.checkSetup()),
  );
  void controller.activate();
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}
