# Synapse: a coding agent for VS Code on TrueForge

*Draft. Fill every TBD, check each claim against the final video, and export to a PDF of at most 3 pages. The headings and their
order are required by the brief. Delete this note.*

## 1. Team

TBD: team name and Techfest Team ID; each member's name, college or employer, and GitHub handle.

## 2. Starting point

From scratch. No upstream code was copied: the extension uses VS Code's API and ordinary dependencies (the TrueForge SDK, the MCP
SDK, `diff` and `zod`). We read Cline, Continue, Roo Code and opencode for ideas, and kept our own codebase small enough that every
member can explain it.

## 3. Architecture on TrueForge

**The extension is a client of a TrueForge agent.** It creates sessions and streams turns with the TypeScript SDK, and renders the
events: tokens as they arrive, tool calls and results, subagent threads, compaction. It never calls a model provider. Agent
definitions live in `agent/definitions` without a model, so the model is purely the user's TrueForge configuration.

**Editor capabilities are MCP tools.** The extension hosts an MCP server on loopback, protected by a per-session token, and
registers it with TrueForge. Eight tools: `retrieve_context`, `read_file`, `search_workspace`, `find_symbol`, `list_files`,
`propose_edit`, `create_file` and `run_command`. The agent decides what to read and change.

**TrueForge's tool approval drives the diff review.** The three writing tools are gated by name. When the agent proposes an edit,
the turn pauses. The extension applies the edit to a copy and opens a review editor with Accept and Reject on every hunk. The
approval it sends back records the accepted result, and the tool then writes exactly that and tells the agent which hunks were
rejected. A second lock means a write tool refuses anything not approved in review, even if a definition were misconfigured.

**Harness features we use:** subagents isolate exploration so only summaries reach the root context, rarely used tools are deferred
(`find_symbol`, `list_files`), and compaction is on. We switch off large-tool-result offloading: without a sandbox it would replace
a big result with a preview the agent cannot read past, so our tools bound their own output instead. TBD: name the features the
final video's session actually shows.

**Safety and resilience.** Every write goes through a journal, so any change can be undone, and cancel or failure restores every file
the run touched. When a model fails, the extension retries with backoff, then swaps the session to the next configured model with a
`PATCH`, keeping its history. TrueForge has no fallback of its own, so this chain lives in the client, choosing only among models
configured in TrueForge.

## 4. How context is selected

Explicit `@file` and `@symbol` mentions spend the budget first (8,000 tokens by default). Automatic retrieval spends the rest before
the first turn, and the agent can retrieve more on demand.

Retrieval is deterministic and lexical, so it behaves the same with any model and needs no index service. Code is chunked at
definitions and docs at headings. Chunks are scored with BM25, boosted for symbol and heading matches. Path matches are weighted by
how rare the term is: in Flask, `cli` appears in three paths, while `flask` and `test` appear everywhere. Words such as "test" and
"documented" count as intent rather than search terms. The tests and docs of the top source files rank directly below them, which is
what makes a multi-file change discoverable. The budget is spent breadth first over at most ten files, then in depth towards the top
of the ranking.

On Task B, with no file named, it ranks `src/flask/cli.py` first, then `docs/cli.rst` and `tests/test_cli.py`, in about 100 ms over
217 files. The panel shows each snippet chosen, its size and why, before the model starts. A golden test holds this in place.

## 5. Model setup

| Model | Where it ran | Approximate cost |
| --- | --- | --- |
| TBD | TBD | TBD (the panel prints tokens and cost after each run) |

Models are configured in TrueForge. A user switches models by editing the ordered `synapse.models` setting: the first is primary,
and the rest are automatic fallbacks. `agent/models.example.json` is the example configuration.

## 6. Scorecard

| Criterion | Video | Claim |
| --- | --- | --- |
| A1 Inline edit | TBD | Diff rendered in the editor with per-hunk Accept and Reject |
| A2 Agent mode | TBD | Finds and edits three files with none named (Task B) |
| A3 Streaming and cancellation | TBD | Tokens stream; Stop restores every file the run changed, at once |
| B1 Context assembly | TBD | Budgeted retrieval, with each choice and its reason shown in Task B |
| B2 Diff safety | TBD | Per-hunk review, nothing written before it, and working undo |
| B3 Resilience | TBD | Automatic fallback to a second model, workspace unchanged |
| B4 TrueForge integration | TBD | MCP tools, approval-driven review, TBD feature visible in the session |
| C1 Video | TBD | All three tasks in order, each verified on screen |
| C2 Write-up | n/a | This document |

## 7. Tools used

Claude Code (Anthropic) was used to scaffold the repository and to write and test code alongside the team. TBD: any other tools.

## 8. Known limitations

- Lexical retrieval misses requests worded unlike the code. The agent can still search, and local embeddings would be the next signal.
- Cancel restores the whole run, including hunks the user had already accepted. That is predictable, but not always what is wanted.
- Review happens in a separate read-only tab rather than in the live document.
- One VS Code window at a time, since each registers the same MCP server name.
- The retrieval index is rebuilt for every request: fine at Flask's size, slow for very large repositories.
- Tests use a scripted model, so agent judgement is only checked by rehearsal. TBD: what rehearsal with real models showed.

With another month: an inline review in the live document, a cached index with semantic ranking, and contributing the model fallback
chain to TrueForge itself.
