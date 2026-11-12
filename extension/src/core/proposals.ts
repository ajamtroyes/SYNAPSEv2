export interface SearchReplaceEdit {
  old_text: string;
  new_text: string;
}

export type ProposalResult = { ok: true; proposed: string } | { ok: false; reason: string };

/**
 * Applies anchored edits. `old_text` must match exactly once, which turns "confidently edits a
 * symbol that does not exist" into a precise error the agent can act on instead of a bad diff.
 */
export function applyEdits(path: string, original: string, edits: readonly SearchReplaceEdit[]): ProposalResult {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const toFileEol = (value: string): string => value.replace(/\r?\n/g, eol);
  let text = original;
  for (const [index, edit] of edits.entries()) {
    const label = `edit ${String(index + 1)} of ${String(edits.length)} for ${path}`;
    if (edit.old_text === '') {
      return { ok: false, reason: `${label}: old_text is empty. Use create_file for new files.` };
    }
    const needle = toFileEol(edit.old_text);
    const first = text.indexOf(needle);
    if (first === -1) {
      return { ok: false, reason: `${label}: old_text was not found. Call read_file and copy the text exactly.` };
    }
    if (text.indexOf(needle, first + 1) !== -1) {
      return { ok: false, reason: `${label}: old_text matches more than once. Include more surrounding lines.` };
    }
    text = text.slice(0, first) + toFileEol(edit.new_text) + text.slice(first + needle.length);
  }
  if (text === original) {
    return { ok: false, reason: `The edits for ${path} change nothing.` };
  }
  return { ok: true, proposed: text };
}
