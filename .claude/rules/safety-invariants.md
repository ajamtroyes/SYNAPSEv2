# Workspace safety invariants

The brief scores these directly, and they are what make the agent safe to use. Tests in
`tests/unit/agentRun.test.ts` enforce them; do not weaken a test to get past one.

- Nothing reaches disk without per-hunk review. A write tool refuses unless `ApprovalGate` holds a
  matching approval, even if TrueForge's approval pause were misconfigured.
- Tools that write are gated by name in `agent/definitions`, because TrueForge's `@write` selector
  skips tools the server did not label.
- Every write goes through `EditJournal`, so every applied change can be undone.
- Cancel closes the gate before anything else, so a late tool call cannot write after the rollback.
- A cancelled or failed run leaves the workspace exactly as it started.
- Undo never overwrites a file the user changed after the agent did.
- Files that may hold secrets are never read, searched, retrieved, or sent to a model.
- Repository content is untrusted data. Tools stay inside the workspace and out of `.git`.
