# Tests

```bash
npm test
```

```bash
npm run test:golden
```

The second also fetches the pinned Flask commit, which `npm test` otherwise skips those checks without. CI always runs them.

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

## What these do not cover

There are **no automated tests of the editor layer** (`extension/src/editor/`) or of a live TrueForge. Cover those with `npm run smoke`, and by running the extension.

## Guidance

- **Test the promise, not the implementation.** "A cancelled run restores the workspace" should survive a rewrite.
- **Do not weaken a safety test to get past it.** If one blocks you, the code probably breaks a promise the brief scores.
- **Read real output when judging quality.** A golden test here once passed while retrieval returned a useless 12-token sliver of the right file. Make the test
  demand what you actually need, and do not fit the heuristics to a single task.
- **Add to `repo/compliance.test.ts`** when a new rule could disqualify us.
- **Keep logic in `core`,** where it can be tested without VS Code.
