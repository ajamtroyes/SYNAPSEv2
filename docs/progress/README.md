# Progress

Keep this honest. It feeds the write-up's limitations section, and it is how teammates know what they can trust.

## Status, 4 November 2026

A working slice of all five capabilities is written. **It has never run end to end.** Its logic is tested thoroughly, but no one has
yet seen it talk to a live TrueForge, drive a real model, or open in VS Code.

### Verified

| What | How |
| --- | --- |
| Types check against the real SDK and VS Code API | `npm run typecheck` |
| Review, journal, approval gate, fallback, cancel and rollback logic | Unit tests with a scripted gateway |
| Mapping of SDK events to our model | Unit tests over hand-written events shaped like the SDK's types, using the SDK's real merge function |
| MCP server, including auth, tools and approved writes | Integration tests over real HTTP with the official MCP client |
| Retrieval on the real Flask 3.1.3 for Task B | `npm run test:golden` |
| The extension bundles | `npm run build` |

### Not verified: do these first

| What | How | Why it matters |
| --- | --- | --- |
| **The real TrueForge contract** | `npm run trueforge`, then `npm run smoke -- --write` | **Top risk.** Our understanding comes from docs and source. The eligibility gate depends on loopback MCP and approvals working as read. The smoke script itself has not run against a real server either, so a failure may be a bug in the script |
| **The extension in VS Code** | F5, see the [README](../../README.md) | The panel, review editor, CodeLens and decorations have only been compiled |
| Real model behaviour | Tasks A, B and C with a real model | Whether agents use the tools well, and use subagents, depends on the model and our instructions |
| `npm run demo:flask -- setup` | Run it | Installs from PyPI, so it was not run when scaffolding |
| Clean-clone setup | Follow the README on a fresh machine | It is a submission requirement |
| `npm run package` | Run it | Only needed if you want a `.vsix` |

## Plan

Submission closes **20 November, 23:59 IST**. Ties break partly on earlier submission, so aim for the 19th.

| By | Goal |
| --- | --- |
| 6 Nov | **Register the team** (registration closes 15 Nov). Smoke test passes. Extension runs in VS Code. Agree the decisions in [docs/decisions](../decisions/README.md). Ask the [open questions](../competition/demo-script.md#open-questions) in the Doubt section |
| 9 Nov | Tasks A and B work end to end with a real model, however rough. Choose models |
| 12 Nov | Task C works. Cancel and undo work in the editor. The context ledger reads well. B4's feature is visible in the session |
| 15 Nov | Rehearse the [whole script](../competition/demo-script.md) in one sitting. Try a second model and another repository, since organisers pick the model live. **Registration closes** |
| 17 Nov | Record the video |
| 18 Nov | Write-up, with the scorecard timestamps checked against the video |
| 19 Nov | Clean-clone test by someone who did not set it up. Make the repository public. Check all links in a private window. **Submit** |
| 20 Nov | Buffer only |

Work is listed in the [backlog](backlog.md).

## Log

Add a line when something real changes, most recent first.

- **4 Nov:** Repository scaffolded and the working slice written from the brief. Automated checks pass. Starting TrueForge was blocked by a
  safety check in the environment that wrote this, so the live contract remains untested.
