export interface SearchReplaceEdit {
  old_text: string;
  new_text: string;
}

export type ProposalResult = { ok: true; proposed: string } | { ok: false; reason: string };

interface Span {
  start: number;
  end: number;
  /** Indentation to add to each line of the replacement, when the model dropped the file's indentation. */
  reindent?: { from: string; to: string };
}

type Located = { found: Span } | { ambiguous: true } | undefined;

const leadingSpace = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? '';

/** Line-wise matching, used only when the exact text is not found, and only on a single match. */
function locateByLines(text: string, needle: string, eol: string, compare: (a: string, b: string) => boolean): Located {
  const needleLines = needle.split(eol);
  while (needleLines.length > 1 && needleLines.at(-1)?.trim() === '') {
    needleLines.pop();
  }
  if (needleLines.every(line => line.trim() === '')) {
    return undefined;
  }
  const lines = text.split(eol);
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + eol.length;
  }
  const matches: number[] = [];
  for (let start = 0; start + needleLines.length <= lines.length; start += 1) {
    if (needleLines.every((line, index) => compare(lines[start + index] ?? '', line))) {
      matches.push(start);
    }
  }
  if (matches.length > 1) {
    return { ambiguous: true };
  }
  const start = matches[0];
  if (start === undefined) {
    return undefined;
  }
  const last = start + needleLines.length - 1;
  const span: Span = { start: offsets[start] ?? 0, end: (offsets[last] ?? 0) + (lines[last] ?? '').length };
  const fileIndent = leadingSpace(lines[start] ?? '');
  const needleIndent = leadingSpace(needleLines[0] ?? '');
  return { found: fileIndent === needleIndent ? span : { ...span, reindent: { from: needleIndent, to: fileIndent } } };
}

function reindent(text: string, eol: string, change: { from: string; to: string }): string {
  return text
    .split(eol)
    .map(line => (line.trim() === '' ? line : change.to + (line.startsWith(change.from) ? line.slice(change.from.length) : line.trimStart())))
    .join(eol);
}

/**
 * Applies anchored edits. `old_text` must match exactly once, which turns "confidently edits a symbol
 * that does not exist" into a precise error the agent can act on instead of a bad diff.
 *
 * Models copy text imperfectly, and the organisers may choose a weak one, so two looser matches are
 * tried when the exact text is absent: ignoring trailing whitespace, then ignoring indentation (and
 * re-indenting the replacement to fit). Each still requires a single match, and the user reviews the
 * result hunk by hunk before anything is written.
 */
export function applyEdits(path: string, original: string, edits: readonly SearchReplaceEdit[]): ProposalResult {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const toFileEol = (value: string): string => value.replace(/\r?\n/g, eol);
  let text = original;
  for (const [index, edit] of edits.entries()) {
    const label = `edit ${String(index + 1)} of ${String(edits.length)} for ${path}`;
    if (edit.old_text.trim() === '') {
      return { ok: false, reason: `${label}: old_text is empty. Use create_file for new files.` };
    }
    const needle = toFileEol(edit.old_text);
    const first = text.indexOf(needle);
    let span: Span;
    if (first !== -1) {
      if (text.indexOf(needle, first + 1) !== -1) {
        return { ok: false, reason: `${label}: old_text matches more than once. Include more surrounding lines.` };
      }
      span = { start: first, end: first + needle.length };
    } else {
      const loose =
        locateByLines(text, needle, eol, (a, b) => a.trimEnd() === b.trimEnd()) ??
        locateByLines(text, needle, eol, (a, b) => a.trim() === b.trim());
      if (loose === undefined) {
        return { ok: false, reason: `${label}: old_text was not found. Call read_file and copy the text exactly.` };
      }
      if ('ambiguous' in loose) {
        return { ok: false, reason: `${label}: old_text matches more than once. Include more surrounding lines.` };
      }
      span = loose.found;
    }
    let replacement = span.reindent ? reindent(toFileEol(edit.new_text), eol, span.reindent) : toFileEol(edit.new_text);
    // A line-wise match stops before the final line break, so the replacement must not add one.
    if (first === -1 && needle.endsWith(eol) && replacement.endsWith(eol)) {
      replacement = replacement.slice(0, -eol.length);
    }
    text = text.slice(0, span.start) + replacement + text.slice(span.end);
  }
  if (text === original) {
    return { ok: false, reason: `The edits for ${path} change nothing.` };
  }
  return { ok: true, proposed: text };
}
