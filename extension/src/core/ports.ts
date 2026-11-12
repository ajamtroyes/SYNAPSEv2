/** File access the core depends on. `path` is always workspace-relative with forward slashes. */
export interface FilePort {
  /** Returns undefined when the file does not exist. */
  read(path: string): Promise<string | undefined>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface SymbolHit {
  name: string;
  path: string;
  /** One-based. */
  line: number;
  kind?: string;
}

export interface WorkspacePort extends FilePort {
  readonly root: string;
  listFiles(): Promise<string[]>;
  findSymbols(name: string): Promise<SymbolHit[]>;
}
