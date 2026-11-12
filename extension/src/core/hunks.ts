import { diffLines } from 'diff';

export interface Hunk {
  /** One-based, stable within a review. */
  id: number;
  /** Zero-based index of the first original line this hunk replaces. */
  originalStart: number;
  removed: string[];
  added: string[];
}

export type HunkDecision = 'pending' | 'accepted' | 'rejected';

/** Where a hunk's lines sit in the merged review document (zero-based, end exclusive). */
export interface HunkRange {
  hunkId: number;
  removedStart: number;
  removedEnd: number;
  addedStart: number;
  addedEnd: number;
}

export interface ReviewDocument {
  text: string;
  ranges: HunkRange[];
}

/** Splits text keeping each line's terminator, so rejoining is byte-exact (CRLF, no final newline). */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function computeHunks(original: string, proposed: string): Hunk[] {
  const hunks: Hunk[] = [];
  let line = 0;
  let current: Hunk | undefined;
  for (const change of diffLines(original, proposed)) {
    const lines = splitLines(change.value);
    if (change.added || change.removed) {
      current ??= { id: hunks.length + 1, originalStart: line, removed: [], added: [] };
      (change.added ? current.added : current.removed).push(...lines);
      if (change.removed) {
        line += lines.length;
      }
    } else {
      if (current) {
        hunks.push(current);
        current = undefined;
      }
      line += lines.length;
    }
  }
  if (current) {
    hunks.push(current);
  }
  return hunks;
}

/** Rebuilds the file with only the accepted hunks applied. */
export function applyHunks(original: string, hunks: readonly Hunk[], acceptedIds: ReadonlySet<number>): string {
  const lines = splitLines(original);
  let out = '';
  let cursor = 0;
  for (const hunk of hunks) {
    out += lines.slice(cursor, hunk.originalStart).join('');
    out += (acceptedIds.has(hunk.id) ? hunk.added : hunk.removed).join('');
    cursor = hunk.originalStart + hunk.removed.length;
  }
  return out + lines.slice(cursor).join('');
}

/**
 * Builds the read-only document shown during review: the whole file with each hunk's removed
 * lines directly above its added lines. A plain editor (not a diff editor) is used because VS Code
 * hides CodeLens in diff editors by default, and per-hunk controls are what criterion A1 scores.
 */
export function buildReviewDocument(original: string, hunks: readonly Hunk[]): ReviewDocument {
  const lines = splitLines(original);
  const out: string[] = [];
  const ranges: HunkRange[] = [];
  const push = (values: readonly string[]): void => {
    for (const value of values) {
      out.push(value.replace(/\r?\n$/, ''));
    }
  };
  let cursor = 0;
  for (const hunk of hunks) {
    push(lines.slice(cursor, hunk.originalStart));
    const removedStart = out.length;
    push(hunk.removed);
    const removedEnd = out.length;
    push(hunk.added);
    ranges.push({ hunkId: hunk.id, removedStart, removedEnd, addedStart: removedEnd, addedEnd: out.length });
    cursor = hunk.originalStart + hunk.removed.length;
  }
  push(lines.slice(cursor));
  return { text: out.join('\n') + '\n', ranges };
}

export interface ReviewResult {
  accepted: number[];
  rejected: number[];
  after: string;
}

/** Tracks per-hunk decisions for one proposed file change. Holds no editor state. */
export class ReviewSession {
  readonly hunks: readonly Hunk[];
  readonly document: ReviewDocument;
  private readonly decisions = new Map<number, HunkDecision>();

  constructor(
    readonly path: string,
    readonly before: string,
    proposed: string,
  ) {
    this.hunks = computeHunks(before, proposed);
    this.document = buildReviewDocument(before, this.hunks);
    for (const hunk of this.hunks) {
      this.decisions.set(hunk.id, 'pending');
    }
  }

  decisionFor(hunkId: number): HunkDecision {
    return this.decisions.get(hunkId) ?? 'pending';
  }

  decide(hunkId: number, decision: HunkDecision): void {
    if (!this.decisions.has(hunkId)) {
      throw new Error(`Unknown hunk ${String(hunkId)} in review of ${this.path}`);
    }
    this.decisions.set(hunkId, decision);
  }

  decideRemaining(decision: Exclude<HunkDecision, 'pending'>): void {
    for (const [id, current] of this.decisions) {
      if (current === 'pending') {
        this.decisions.set(id, decision);
      }
    }
  }

  get isComplete(): boolean {
    return [...this.decisions.values()].every(value => value !== 'pending');
  }

  /** The hunk whose lines include this document line, or the next one below it. */
  hunkAtOrAfter(line: number): number | undefined {
    return this.document.ranges.find(range => line < range.addedEnd)?.hunkId;
  }

  hunkBefore(line: number): number | undefined {
    return [...this.document.ranges].reverse().find(range => range.removedStart < line)?.hunkId;
  }

  result(): ReviewResult {
    const accepted: number[] = [];
    const rejected: number[] = [];
    for (const [id, decision] of this.decisions) {
      (decision === 'accepted' ? accepted : rejected).push(id);
    }
    return { accepted, rejected, after: applyHunks(this.before, this.hunks, new Set(accepted)) };
  }
}
