# Write-up template

**Start from [write-up-draft.md](write-up-draft.md), which already holds the content.** Export to a **PDF of 1 to 3 pages**, with these eight headings in this order. The notes in italics are
for us, so delete them. Be accurate: criterion C2's top anchor rewards an accurate scorecard and an honest
limitations section.

# Synapse: a coding agent for VS Code on TrueForge

## 1. Team

*Members, college or employer, GitHub handles. Team name and ID: TBD.*

## 2. Starting point

From scratch. *Update this if ADR 0001 changes, and if any upstream code was copied, name the repository
and exact commit here and in the README.*

## 3. Architecture on TrueForge

*How the extension talks to TrueForge, which editor capabilities are MCP tools, which harness features we
used and why. Source: `docs/architecture/README.md`. Cover:*

- *The TypeScript SDK, inline sessions, streamed turn events.*
- *The extension-hosted MCP server: retrieve_context, read_file, search_workspace, find_symbol, list_files,
  propose_edit, create_file, run_command.*
- *Tool approval drives the diff review (ADRs 0002, 0003).*
- *Harness features, as actually seen in the session: subagents, deferred tool loading, compaction.
  Only claim what the session shows.*

## 4. How context is selected

*Retrieval strategy and its budget. Source: `docs/architecture/context-strategy.md`. Include the budget
figure and how Task B's files were found.*

## 5. Model setup

| Model | Where it ran | Approximate cost |
| --- | --- | --- |
| *TBD: every model used, including during development* | *TBD* | *TBD* |

*How a user switches models: the `synapse.models` setting, first is primary, the rest are fallbacks, all
configured in TrueForge.*

## 6. Scorecard

*One row per judging criterion. Check every timestamp against the final video.*

| Criterion | Video timestamp | Claim |
| --- | --- | --- |
| A1 Inline edit | | |
| A2 Agent mode | | |
| A3 Streaming and cancellation | | |
| B1 Context assembly | | |
| B2 Diff safety | | |
| B3 Resilience | | |
| B4 TrueForge integration depth | | |
| C1 Video | | |
| C2 Write-up | | |

## 7. Tools used

*The brief requires any AI coding assistants to be declared, and this costs no points. The initial
repository was scaffolded with Claude Code: keep that here, and add anything else used.*

## 8. Known limitations

*Honest, and what we would do with another month. Start from `docs/progress/README.md` and
`docs/progress/backlog.md`.*
