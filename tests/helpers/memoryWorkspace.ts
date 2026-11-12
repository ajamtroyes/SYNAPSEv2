import type { SymbolHit, WorkspacePort } from '../../extension/src/core/ports';
import { extractDefinitions } from '../../extension/src/core/retrieval';

/** An in-memory workspace, so tests can assert exactly what was written and when. */
export class MemoryWorkspace implements WorkspacePort {
  readonly root = '/workspace';
  readonly files: Map<string, string>;
  readonly writes: string[] = [];
  /** Simulates format-on-save. */
  transformOnWrite: (text: string) => string = text => text;

  constructor(initial: Record<string, string> = {}) {
    this.files = new Map(Object.entries(initial));
  }

  read(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path));
  }

  write(path: string, text: string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, this.transformOnWrite(text));
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.writes.push(path);
    this.files.delete(path);
    return Promise.resolve();
  }

  listFiles(): Promise<string[]> {
    return Promise.resolve([...this.files.keys()]);
  }

  findSymbols(name: string): Promise<SymbolHit[]> {
    const hits: SymbolHit[] = [];
    for (const [path, text] of this.files) {
      for (const definition of extractDefinitions(text)) {
        if (definition.name === name) {
          hits.push({ name, path, line: definition.line + 1 });
        }
      }
    }
    return Promise.resolve(hits);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}
