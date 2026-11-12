import { describe, expect, it } from 'vitest';
import { applyHunks, buildReviewDocument, computeHunks, ReviewSession, splitLines } from '../../extension/src/core/hunks';

const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', ''].join('\n');
const after = ['one', 'TWO', 'three', 'four', 'five', 'six!', 'six!!', 'seven', 'eight', ''].join('\n');

describe('splitLines', () => {
  it('rejoins to exactly the input, whatever the line endings', () => {
    for (const text of ['', 'a', 'a\n', 'a\nb', 'a\r\nb\r\n', '\n\n', 'a\r\n\nb']) {
      expect(splitLines(text).join('')).toBe(text);
    }
  });
});

describe('computeHunks', () => {
  it('finds each separate change', () => {
    const hunks = computeHunks(before, after);
    expect(hunks.map(hunk => hunk.id)).toEqual([1, 2, 3]);
    expect(hunks[0]).toMatchObject({ originalStart: 1, removed: ['two\n'], added: ['TWO\n'] });
    expect(hunks[1]).toMatchObject({ originalStart: 5, removed: ['six\n'], added: ['six!\n', 'six!!\n'] });
    expect(hunks[2]).toMatchObject({ originalStart: 7, removed: [], added: ['eight\n'] });
  });

  it('reports nothing for identical text', () => {
    expect(computeHunks(before, before)).toEqual([]);
  });

  it('treats a new file as one added hunk', () => {
    expect(computeHunks('', 'a\nb\n')).toEqual([{ id: 1, originalStart: 0, removed: [], added: ['a\n', 'b\n'] }]);
  });
});

describe('applyHunks', () => {
  const hunks = computeHunks(before, after);

  it('accepting everything gives the proposal', () => {
    expect(applyHunks(before, hunks, new Set([1, 2, 3]))).toBe(after);
  });

  it('accepting nothing gives the original', () => {
    expect(applyHunks(before, hunks, new Set())).toBe(before);
  });

  it('accepting a subset applies only that subset', () => {
    expect(applyHunks(before, hunks, new Set([2]))).toBe(['one', 'two', 'three', 'four', 'five', 'six!', 'six!!', 'seven', ''].join('\n'));
  });

  it('preserves CRLF and a missing final newline', () => {
    const original = 'a\r\nb\r\nc';
    const proposed = 'a\r\nB\r\nc';
    const changes = computeHunks(original, proposed);
    expect(applyHunks(original, changes, new Set())).toBe(original);
    expect(applyHunks(original, changes, new Set([1]))).toBe(proposed);
  });
});

describe('buildReviewDocument', () => {
  it('places each hunk with removed lines above added lines', () => {
    const document = buildReviewDocument(before, computeHunks(before, after));
    const lines = document.text.split('\n');
    const first = document.ranges[0];
    expect(first).toBeDefined();
    expect(lines.slice(first?.removedStart, first?.removedEnd)).toEqual(['two']);
    expect(lines.slice(first?.addedStart, first?.addedEnd)).toEqual(['TWO']);
  });

  it('keeps later ranges aligned after earlier hunks grow', () => {
    const document = buildReviewDocument(before, computeHunks(before, after));
    const lines = document.text.split('\n');
    const last = document.ranges.at(-1);
    expect(lines.slice(last?.addedStart, last?.addedEnd)).toEqual(['eight']);
  });
});

describe('ReviewSession', () => {
  it('is complete only when every hunk is decided', () => {
    const session = new ReviewSession('f.txt', before, after);
    expect(session.isComplete).toBe(false);
    session.decide(1, 'accepted');
    session.decide(2, 'rejected');
    expect(session.isComplete).toBe(false);
    session.decideRemaining('accepted');
    expect(session.isComplete).toBe(true);
    expect(session.result().accepted).toEqual([1, 3]);
    expect(session.result().rejected).toEqual([2]);
  });

  it('treats an undecided hunk as rejected, because a write needs an explicit yes', () => {
    const session = new ReviewSession('f.txt', before, after);
    session.decide(1, 'accepted');
    const result = session.result();
    expect(result.accepted).toEqual([1]);
    expect(result.rejected).toEqual([2, 3]);
    expect(result.after).toContain('TWO');
    expect(result.after).not.toContain('eight');
  });

  it('refuses a hunk id that does not exist', () => {
    expect(() => {
      new ReviewSession('f.txt', before, after).decide(99, 'accepted');
    }).toThrow(/Unknown hunk/);
  });

  it('finds the hunk at or after a cursor line', () => {
    const session = new ReviewSession('f.txt', before, after);
    const second = session.document.ranges[1];
    expect(session.hunkAtOrAfter(0)).toBe(1);
    expect(session.hunkAtOrAfter(second?.removedStart ?? -1)).toBe(2);
    expect(session.hunkAtOrAfter(10_000)).toBeUndefined();
  });
});
