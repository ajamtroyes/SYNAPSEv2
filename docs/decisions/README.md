# Decisions

Each record says what was decided, why, and what it gives up. The code implements all of them, but they were
made while scaffolding, so **the team should review them.** Change one by editing its record and updating the
code, and say why. They are also the raw material for the write-up's trade-offs.

| Record | Decision | Status |
| --- | --- | --- |
| [0001](0001-start-from-scratch.md) | Start from scratch instead of forking | **Team to confirm** |
| [0002](0002-loopback-mcp-server.md) | The extension hosts an MCP server on loopback | Implemented; live check pending |
| [0003](0003-approval-drives-review.md) | TrueForge tool approval drives a per-hunk review | Implemented; live check pending |
| [0004](0004-cancel-rolls-back.md) | Cancel and failure roll the whole run back | Implemented |
| [0005](0005-client-side-model-fallback.md) | Model fallback lives in the client, over inline sessions | Implemented; live check pending |
| [0006](0006-lexical-retrieval.md) | Budgeted lexical retrieval, not embeddings | Implemented |
| [0007](0007-tools-bound-their-own-output.md) | Tools bound their own output, with no sandbox | Implemented |

## Still open: these are the team's to decide

- **Project and team name.** "Synapse" comes from the repository's name, `SYNAPSEv2`, and is only a working name.
  Renaming means replacing `synapse` across `extension/` and the docs. The team name also becomes a hashtag in
  the social media contest.
- **Team members and owners.** See the [backlog](../progress/backlog.md).
- **Which models to use.** `agent/models.example.json` holds examples from TrueForge's catalog, not a choice.
  Cost and speed trade off, and every model used must be declared, with its approximate cost.
- **Whether the brief's PDF stays in the repository once it is public.** It is kept in `docs/competition/` for the
  team. Nothing in the brief forbids this, but it is Techfest's document, so remove it if you prefer.
- **The licence holder.** `LICENSE` says "Forgeathon contributors".
