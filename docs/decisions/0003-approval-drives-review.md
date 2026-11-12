# 0003: TrueForge tool approval drives a per-hunk review

**Status:** Implemented. Live check pending: `npm run smoke` covers approvals; the review UI needs a run in VS Code.

## Context

B4's 7-point anchor asks for "TrueForge tool approval driving the diff review", and A1 and B2's top anchors ask for
per-hunk accept and reject. TrueForge's approval is allow or deny for a whole tool call, so partial acceptance needs
a mapping. Two details matter: `@write` and `@destructive` skip tools the server did not label, and an approval pause
ends the turn, so a slow human review cannot time out.

## Decision

- Writing tools are gated **by name** in the definitions.
- On a pause, the extension applies the edits to a copy and opens a review. If `old_text` does not match exactly once,
  the call is denied with the reason and the user never sees it.
- If some hunks are accepted, the decision is `allow`. The result is recorded in `ApprovalGate`, keyed by a hash of the
  tool name and arguments. When TrueForge runs the tool, it applies that recorded result, not the raw arguments, and
  reports which hunks were rejected so the agent's picture stays true. If none are accepted, the decision is `deny`.
- The review is a **read-only editor showing the merged file**, with removed lines above added lines. CodeLens gives
  Accept and Reject on each hunk, and `Alt+Y`, `Alt+N`, `Alt+]` and `Alt+[` work from the keyboard.

A plain editor is used because VS Code hides CodeLens in diff editors by default (`diffEditor.codeLens`), so per-hunk
controls would not appear there.

## Why the gate as well as the pause

Defence in depth. If a definition were misconfigured and the pause never fired, the tool would find no approval and
refuse. An approval is also single-use, and refused if the file changed during review.

## What it gives up

- Not the live document, so the user reviews in a separate tab. Reviewing inline, as Continue does, is the obvious
  upgrade if the demo feels weak.
- It depends on `editor.codeLens`, which is on by default. If it is off, the keyboard commands still work.
- Matching by content means two identical pending calls share an approval. Each is single-use, so the second is refused
  rather than applied twice.
