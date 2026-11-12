# Progress

Keep this honest. It feeds the write-up's limitations section, and it is how teammates know what they can trust.

## Status, 12 November 2026

All five capabilities are written, and **the extension's code now runs end to end against a live TrueForge**. The editor UI
itself (panel, review editor, CodeLens, keybindings) is the main thing still unproven, along with behaviour on a real model.

### Verified

| What | How |
| --- | --- |
| The TrueForge contract we rely on: loopback MCP, approval by name, unchanged arguments, deny, deferred tools, cancel, both Task C failures, the PATCH model swap | `npm run smoke`, live on 0.183.0, 11 of 11 ([results](../research/smoke-results.md)) |
| The extension's real code against live TrueForge: inline edit, a three-file agent run with parallel approvals and a command, rejection, cancel with rollback, fallback, total failure, deferred tools | `npm run test:e2e`, 7 of 7, with the scripted model standing in for a real one |
| Review, journal, approval gate, fallback, cancel and rollback logic | Unit tests with a scripted gateway |
| MCP server, including auth, tools and approved writes | Integration tests over real HTTP with the official MCP client |
| Retrieval on the real Flask 3.1.3 for Task B | `npm run test:golden` |
| Types check against the real SDK and VS Code API, and the extension bundles | `npm run typecheck`, `npm run build` |

### Not verified yet

| What | How | Why it matters |
| --- | --- | --- |
| **The extension in VS Code** | F5, see the [README](../../README.md) | The panel, review editor, CodeLens and decorations have only been compiled |
| **Real model behaviour** | Tasks A, B and C with a real model | Whether the agent uses the tools well, states its choices and uses subagents depends on the model and our instructions |
| `npm run demo:flask -- setup` | Run it | Installs Flask's dependencies from PyPI |
| Clean-clone setup by someone else | Follow the README on a fresh machine | It is a submission requirement |

## Plan

Submission closes **20 November, 23:59 IST**. Ties break partly on earlier submission, so aim for the 19th.

| By | Goal |
| --- | --- |
| 13 Nov | **Register the team now** (registration closes 15 Nov). Agree the decisions in [docs/decisions](../decisions/README.md) and choose models. Ask the [open questions](../competition/demo-script.md#open-questions) in the Doubt section |
| 14 Nov | Extension runs in VS Code with the mock model. Tasks A and B work end to end with a real model, however rough |
| 15 Nov | Task C, cancel and undo work in the editor. B4's feature is visible in the TrueForge session. **Registration closes** |
| 16 Nov | Rehearse the [whole script](../competition/demo-script.md) in one sitting. Try a second model, since organisers pick the model live |
| 17 Nov | Record the video |
| 18 Nov | Write-up, with the scorecard timestamps checked against the video |
| 19 Nov | Clean-clone test by someone who did not set it up. Make the repository public. Check all links in a private window. **Submit** |
| 20 Nov | Buffer only. Deadline 23:59 IST |

Work is listed in the [backlog](backlog.md).

## Log

Add a line when something real changes, most recent first.

- **12 Nov:** Ran TrueForge live for the first time. The smoke test passes 11 of 11 after fixing a bug in the script itself, and new
  end-to-end tests run the extension's real code against it, 7 of 7. Corrected the research note: deferred calls report `call_tool`
  as their tool name.
- **4 Nov:** Repository scaffolded and the working slice written from the brief. Automated checks pass. Starting TrueForge was blocked by a
  safety check in the environment that wrote this, so the live contract remains untested.
