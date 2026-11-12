# How context is selected

The brief calls this the intellectual core of the problem, and B1 is the largest single criterion. Once a
repository no longer fits in a context window, what goes in and what stays out decides whether the agent
works at all. This is also the source for section 4 of the write-up.

## Requirements we designed for

- **Works on any model, with no setup.** The organisers may pick the model. Quality cannot depend on a
  particular provider's embeddings, a language server, or a hosted index, and a hosted service is out of
  scope anyway.
- **Finds what the user did not name.** A change also needs its tests and docs, which often share few
  words with the request.
- **Respects a budget,** with the choices visible.

## Layers

1. **Explicit mentions come first.** `@file` and `@symbol` spend the budget before anything inferred.
2. **Automatic retrieval, before the first turn.** The default budget is 8,000 tokens
   (`synapse.context.budgetTokens`), minus what mentions used. Tokens are estimated as characters / 4,
   because real tokenizers differ per model.
3. **More retrieval on demand.** The agent can call `retrieve_context`, `search_workspace`, `read_file` and
   `find_symbol`. Every result is bounded.
4. **The harness keeps the rest small.** Subagents isolate heavy exploration, so only their summaries reach
   the root context. Rarely used tools are deferred. Compaction runs near the model's limit.

## The retrieval algorithm

Deterministic, lexical, and fast enough to run before every request.

1. **Chunking.** Code splits at top-level definitions, Markdown at headings, reStructuredText at section
   titles. File type decides the rules, since `# text` is a heading in Markdown and a comment in Python.
   Chunks are at most 60 lines.
2. **Query terms.** Identifiers split on case and underscores, with light stemming, so `commands` matches
   `command` and "retried" matches `retry`. Adjacent words are also tried joined, because people write
   "falling back" or "set up" where code says `fallback` or `setup`. Words like "test" and "documented" are
   treated as **intent, not search terms**: they say what a complete change includes, not where the code is.
   Left in, they rank every test file highly.
3. **Scoring.** BM25 over chunks, boosted when a term is in a symbol name or section heading.
4. **File ranking.** The strongest few chunks count, so a file cannot rank highly just for being long. Path
   matches are weighted by how rare the term is across all paths: in Flask, `cli` appears in three paths and
   says a lot, while `flask` and `test` appear in many and say almost nothing. Prose files rank at half weight,
   since design notes match a request's words well but are rarely what needs editing; the docs that do need
   editing arrive as companions.
5. **Companions.** The tests and docs of the top source files, found by naming convention, rank directly
   below their source. This is what makes a multi-file change discoverable.
6. **Spending the budget.** Breadth first across at most 10 files, so several files always get in. Then
   depth, in rounds narrowing to the top of the ranking, so the file most likely to change gets the most. One
   file can take at most 40%.

## Visible at work

The panel shows a ledger before the model starts: tokens used against budget, each snippet with its lines and
the reason it was chosen, and what was left out. The agent's instructions also tell it to state which files it
chose and why before editing. Criterion B1's top anchor asks for exactly this.

## Result on Task B

From the pinned Flask commit, with the exact Task B wording and the default budget, in about 100 ms over 217
files, using 7,988 of 8,000 tokens. The files, in rank order:

| File | Why it was chosen | Useful content |
| --- | --- | --- |
| `src/flask/cli.py` | Path matches `cli`; defines the commands | `add_command(routes_command)`, `shell_command`, `routes_command` |
| `docs/cli.rst` | Companion of `cli.py` | The "Open a Shell" and "Custom Commands" sections |
| `tests/test_cli.py` | Companion of `cli.py` | Existing CLI tests to copy the style of |
| `tests/test_basic.py`, `src/flask/config.py`, `docs/config.rst`, others | Lexical matches on `config`, `secret`, `key` | Partly noise, kept small by the rank-weighted budget |

`tests/golden/retrieval-flask.test.ts` holds this in place. It checks ranking and content, not just that a path
appears, because an earlier version passed with `docs/cli.rst` reduced to a useless 12-token sliver.

## Trade-offs and limits

- **No embeddings.** A request worded unlike the code can miss. The agent can still search, and no provider or
  hosted index is needed, which is the point.
- **The index is rebuilt per request.** That is fine at Flask's size, but a large repository would want a cache.
- **Companions rely on naming conventions.** They can pull in fixtures (`tests/static/config.json` is an example)
  or miss unconventionally named tests.
- **Multi-line decorators split from their function** into separate chunks.
- **Task-specific tuning is a risk.** The golden test is one task, so we also checked four requests with known
  answers on this repository, which is TypeScript and heavy on prose. The first run found the right source file
  first in two of four, and missed `fallback.ts` entirely for "retry limit before falling back". Joined words and
  the prose weighting brought it to first, without changing Flask's result. Keep checking on other code before
  Round 2, whose material we will not have seen.
