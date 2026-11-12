import * as vscode from 'vscode';
import type { SymbolHit, WorkspacePort } from '../core/ports';
import { extractDefinitions } from '../core/retrieval';

const EXCLUDE = '**/{.git,node_modules,dist,build,out,target,vendor,coverage,__pycache__,.venv,venv,.tox,.mypy_cache,.pytest_cache,.ruff_cache,.next,.idea,.cache,.nox}/**';
const MAX_FILES = 20_000;
const SYMBOL_SCAN_FILE = /\.(py|pyi|ts|tsx|js|jsx|mjs|go|rs|java|kt|rb|php|cs|c|h|cc|cpp|hpp|swift|scala)$/i;

/** Reads see unsaved editor buffers, because that is what the user is looking at. */
export class VscodeWorkspace implements WorkspacePort {
  constructor(private readonly folder: vscode.WorkspaceFolder) {}

  get root(): string {
    return this.folder.uri.fsPath;
  }

  private uri(path: string): vscode.Uri {
    return vscode.Uri.joinPath(this.folder.uri, ...path.split('/'));
  }

  async read(path: string): Promise<string | undefined> {
    const uri = this.uri(path);
    const open = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
    if (open) {
      return open.getText();
    }
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch (error) {
      if (error instanceof vscode.FileSystemError) {
        return undefined;
      }
      throw error;
    }
  }

  async write(path: string, text: string): Promise<void> {
    const uri = this.uri(path);
    if ((await this.read(path)) === undefined) {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
      return;
    }
    // A workspace edit plus save keeps the change in the editor's own undo stack too.
    const document = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), text);
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error(`The editor refused the edit to ${path}.`);
    }
    if (!(await document.save())) {
      throw new Error(`Could not save ${path}.`);
    }
  }

  async remove(path: string): Promise<void> {
    await vscode.workspace.fs.delete(this.uri(path));
  }

  async listFiles(): Promise<string[]> {
    const pattern = new vscode.RelativePattern(this.folder, '**/*');
    const uris = await vscode.workspace.findFiles(pattern, EXCLUDE, MAX_FILES);
    return uris.map(uri => vscode.workspace.asRelativePath(uri, false).split('\\').join('/'));
  }

  async findSymbols(name: string): Promise<SymbolHit[]> {
    const fromLanguageServer = await vscode.commands.executeCommand<vscode.SymbolInformation[] | undefined>(
      'vscode.executeWorkspaceSymbolProvider',
      name,
    );
    const hits = (fromLanguageServer ?? [])
      .filter(symbol => symbol.location.uri.fsPath.startsWith(this.root))
      .map(symbol => ({
        name: symbol.name,
        path: vscode.workspace.asRelativePath(symbol.location.uri, false).split('\\').join('/'),
        line: symbol.location.range.start.line + 1,
        kind: vscode.SymbolKind[symbol.kind] ?? 'symbol',
      }));
    return hits.length > 0 ? hits : this.scanForDefinitions(name);
  }

  /** The agent must still find symbols when no language server is installed, as on a judge's machine. */
  private async scanForDefinitions(name: string): Promise<SymbolHit[]> {
    const hits: SymbolHit[] = [];
    for (const path of (await this.listFiles()).filter(candidate => SYMBOL_SCAN_FILE.test(candidate))) {
      const content = await this.read(path);
      if (content === undefined) {
        continue;
      }
      for (const definition of extractDefinitions(content)) {
        if (definition.name === name) {
          hits.push({ name, path, line: definition.line + 1, kind: 'definition' });
        }
      }
    }
    return hits;
  }
}
