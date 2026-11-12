# Tests

```bash
npm test
```

```bash
npm run test:golden
```

The second also fetches the pinned Flask commit, which `npm test` otherwise skips those checks without. CI always runs them.

Two more suites need a running TrueForge (`npm run trueforge`) and use the scripted model, so they need no API key:

```bash
npm run test:e2e
```

```bash
npm run test:vscode
```

`test:e2e` runs the extension's real code against TrueForge without an editor. `test:vscode` runs the built extension inside a real
VS Code, which it downloads to `.vscode-test/` on first use. A VS Code window appears while it runs, and it re-registers the editor's
MCP server, so reload any editor you are using afterwards. Neither runs in CI, since CI has no TrueForge.

| Path | What it covers |
| --- | --- |
| `unit/agentRun.test.ts` | The run state machine, and the safety promises: no silent writes, cancel and failure restore the workspace |
| `unit/hunks.test.ts` | Hunks, partial application, the review document |
| `unit/safety.test.ts` | Journal, approval gate, paths, anchored edits, fallback policy |
| `unit/retrieval.test.ts` | Ranking, the budget, mentions |
| `unit/gateway.test.ts` | Mapping SDK events, and the agent definitions |
| `integration/mcpServer.test.ts` | The real MCP server over HTTP, with the official client |
| `integration/mockModel.test.ts` | The scripted model's format |
| `golden/retrieval-flask.test.ts` | Retrieval on the real Flask repository, with Task B's exact wording |
| `repo/compliance.test.ts` | Rules that can disqualify the team, such as no direct provider calls and no secrets |
| `e2e/trueforge.e2e.test.ts` | The extension's code against a live TrueForge: inline edit, a three-file agent run, cancel, fallback, failure |
| `vscode/suite.cjs` | The built extension in a real VS Code: review editor and CodeLens, undo, stop, fallback, the panel |

## What these do not cover

The suites use a scripted model, so none of them checks the judgement of a real model. Rehearse the fixed tasks with the model you will
declare. The review editor's colours and decorations are also only checked by eye.

## Guidance

- **Test the promise, not the implementation.** "A cancelled run restores the workspace" should survive a rewrite.
- **Do not weaken a safety test to get past it.** If one blocks you, the code probably breaks a promise the brief scores.
- **Read real output when judging quality.** A golden test here once passed while retrieval returned a useless 12-token sliver of the right file. Make the test
  demand what you actually need, and do not fit the heuristics to a single task.
- **Add to `repo/compliance.test.ts`** when a new rule could disqualify us.
- **Keep logic in `core`,** where it can be tested without VS Code.
