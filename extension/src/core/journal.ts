import type { FilePort } from './ports';

interface JournalEntry {
  runId: string;
  path: string;
  /** Undefined means the file did not exist before this change. */
  before: string | undefined;
  after: string;
}

export interface UndoReport {
  restored: string[];
  /** Files the user changed after the agent did. They are left alone rather than overwritten. */
  conflicts: string[];
}

/**
 * Every write the agent makes goes through here, and each one can be reversed. Operations run one
 * at a time so a rollback triggered by cancel always sees the result of a write already in flight.
 */
export class EditJournal {
  private entries: JournalEntry[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly files: FilePort) {}

  apply(runId: string, path: string, after: string): Promise<void> {
    return this.enqueue(async () => {
      const before = await this.files.read(path);
      await this.files.write(path, after);
      // Read back: format-on-save may have changed it, and undo compares against what is on disk.
      this.entries.push({ runId, path, before, after: (await this.files.read(path)) ?? after });
    });
  }

  /** Reverses the most recent change, whichever run made it. */
  undoLast(): Promise<UndoReport> {
    return this.enqueue(async () => {
      const entry = this.entries.at(-1);
      return entry ? this.revert([entry]) : { restored: [], conflicts: [] };
    });
  }

  /** Reverses all of one run's changes, newest first. Used for cancel, failure and "undo run". */
  rollbackRun(runId: string): Promise<UndoReport> {
    return this.enqueue(() => this.revert(this.entries.filter(entry => entry.runId === runId).reverse()));
  }

  lastRunId(): string | undefined {
    return this.entries.at(-1)?.runId;
  }

  changedPaths(runId: string): string[] {
    return [...new Set(this.entries.filter(entry => entry.runId === runId).map(entry => entry.path))];
  }

  private async revert(targets: readonly JournalEntry[]): Promise<UndoReport> {
    const report: UndoReport = { restored: [], conflicts: [] };
    const conflicted = new Set<string>();
    for (const entry of targets) {
      // A later conflict makes older states of the same file unreachable without losing user work.
      if (conflicted.has(entry.path) || (await this.files.read(entry.path)) !== entry.after) {
        conflicted.add(entry.path);
        continue;
      }
      if (entry.before === undefined) {
        await this.files.remove(entry.path);
      } else {
        await this.files.write(entry.path, entry.before);
      }
      this.entries.splice(this.entries.indexOf(entry), 1);
      if (!report.restored.includes(entry.path)) {
        report.restored.push(entry.path);
      }
    }
    report.conflicts = [...conflicted];
    return report;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
