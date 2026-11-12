# Scoring: 100 points

Judges pick the written anchor that fits, and between two anchors the lower one applies. So each row's
top anchor is the target, and it must be **visible on screen**. "Status" says only what is true today:
see [what has been verified](../progress/README.md).

## A. Capability coverage (30)

| Criterion | Pts | Anchors | How we reach the top | Status |
| --- | --- | --- | --- | --- |
| A1 Inline edit | 10 | 0 not present, or copied by hand · 4 edit but no diff in the editor · 7 diff rendered, accept-all only · **10 diff rendered with per-hunk accept and reject** | `Ctrl+Alt+K`, then a read-only review editor with Accept and Reject on each hunk | Built. Logic tested; not yet run in VS Code |
| A2 Agent mode | 10 | 0 no tool loop · 4 single file only · 7 several files, but the user named them · **10 discovers and edits three or more files unprompted (Task B)** | Retrieval finds the files, and the agent loops on TrueForge | Built. Retrieval checked on real Flask; loop not yet run with a real model |
| A3 Streaming and cancellation | 10 | 0 editor blocks · 4 streams, no cancellation · 7 cancellation can leave half-applied edits · **10 cancellation is immediate and the workspace stays consistent** | Stop closes the write gate, kills commands and rolls the run back at once | Built. Logic tested; server behaviour unconfirmed until the smoke test runs |

## B. Technical depth (45)

| Criterion | Pts | Anchors | How we reach the top | Status |
| --- | --- | --- | --- | --- |
| B1 Context assembly | 15 | 0 whole files until the window fills · 5 explicit @-mentions only · 10 automatic retrieval, strategy stated in the write-up · **15 retrieval with a size budget, strategy stated, and visibly at work in Task B (the agent shows which files it chose and why)** | [Budgeted retrieval](../architecture/context-strategy.md), a ledger in the panel showing each snippet and why, and instructions telling the agent to state its choices | Built. Golden test passes on real Flask |
| B2 Diff safety | 10 | 0 writes without showing · 5 full-file preview · **10 per-hunk review and a working undo of an applied change, shown on screen** | Per-hunk review plus Undo Last Change and Undo Last Run. **Undo must appear in the video** | Built. Logic tested; UI not yet run |
| B3 Resilience (Task C) | 10 | 0 hang, stack trace or files changed · 4 clear error, workspace unchanged · 7 retry with backoff, then clear error · **10 automatic fallback to a second configured model with no user action, workspace unchanged** | Retries with backoff, then a client-side model chain over TrueForge-configured models ([ADR 0005](../decisions/0005-client-side-model-fallback.md)) | Built. Logic tested; session model swap unconfirmed until the smoke test runs |
| B4 TrueForge integration depth | 10 | 4 sessions and turns only · 7 editor capabilities as MCP tools, with TrueForge tool approval driving the diff review · **10 also makes meaningful use of a context-engineering feature (subagents, deferred tool loading, Code Mode, compaction) or skills, explained in the write-up and visible in the session** | MCP tools plus approval drive review. Subagents for exploration, deferred loading for rarely used tools, compaction on | Built. **Whether the agent really uses subagents depends on the model, so check the session** |

## C. Presentation (25)

| Criterion | Pts | Anchors | How we reach the top | Status |
| --- | --- | --- | --- | --- |
| C1 Video | 10 | 0 a fixed task missing or out of order · 5 all three present, outcomes not legible or not verified · **10 all three complete, legible, and visibly verified on screen** | [Demo script](demo-script.md). Zoom in so terminal output is readable | Not started |
| C2 Write-up | 15 | 0 absent or boilerplate · 5 features without design decisions · 10 architecture, context strategy, model setup and trade-offs · **15 also an accurate scorecard with timestamps and an honest limitations section** | [Template](write-up-template.md). The ADRs already hold the trade-offs | Template only |

## What is easy to miss

- **A3 and B2 are not part of any fixed task.** Cancel and undo get no points unless the video shows
  them, so the demo script schedules both.
- **B1's top anchor needs the choice on screen,** not just good retrieval. Keep the context ledger
  visible during Task B.
- **B4's top anchor needs the feature visible in the TrueForge session,** so check it there.
- **Fairness cuts both ways.** A free model scores the same for the same behaviour, but a weak model
  that fails to find the files does not show the behaviour. Rehearse with what you will record with.
