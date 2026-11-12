# The suggested editor projects

The brief suggests Cline, Continue, Roo Code and opencode as sources of editor-side code. This is their state on 4 November 2026,
from each repository's page and file tree. We read the tree and named files, and did not build or run any of them. The conclusion
is in [ADR 0001](../decisions/0001-start-from-scratch.md).

| Project | Licence | Status | Commit checked | Files | Relevant code |
| --- | --- | --- | --- | --- | --- |
| [Cline](https://github.com/cline/cline) | Apache-2.0 | Active | `7a7878cb` (2026-11-04) | ~4,450 | `apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts`, `apps/vscode/src/hosts/vscode/hostbridge/diff/`. Shared core in `sdk/` |
| [Continue](https://github.com/continuedev/continue) | Apache-2.0 | **Read-only, no longer maintained** | `5522c6f4` (2026-07-20) | ~3,060 | `extensions/vscode/src/diff/vertical/manager.ts` (632 lines), `handler.ts` (661 lines, with `acceptRejectBlock`), `lang-server/codeLens/providers/VerticalPerLineCodeLensProvider.ts` |
| [Roo Code](https://github.com/RooCodeInc/Roo-Code) | Apache-2.0 | **Archived 15 May 2026** | `b867ec91` (2026-05-15) | ~3,020 | `src/integrations/editor/DiffViewProvider.ts`, `webview-ui/src/components/chat/BatchDiffApproval.tsx`, `src/services/checkpoints/` |
| [opencode](https://github.com/sst/opencode) (now served from `anomalyco/opencode`) | MIT | Active | `59e95cc5` (2026-11-04) | ~9,220 | `sdks/vscode/`, a small package. Diff rendering is in its own TUI and web packages |

## Things worth knowing

- **The brief's links still work, but two of the four are frozen.** Continue and Roo Code will not take fixes. Their code can still be
  reused under Apache-2.0.
- **Continue has the closest match to A1's top anchor:** per-block accept and reject in the live document, through CodeLens. If our
  merged preview feels weak, this is the code to read. Copying it requires declaring it and keeping its licence.
- **Copied code has rules.** Anything taken must keep its licence and attribution, and be declared with its repository and exact
  commit. Apache-2.0 also requires noting changes to modified files. A licence violation is an eligibility failure.
- **Ideas are free.** Reading how they solved a problem and writing our own needs no declaration, and is the lowest-risk way to benefit.
