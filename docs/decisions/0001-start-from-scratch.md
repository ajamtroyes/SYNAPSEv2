# 0001: Start from scratch instead of forking

**Status:** Team to confirm. This shapes everything else, so it is worth an hour's discussion now.

## Context

The brief encourages reusing open-source editor code ("rebuilding a diff viewer from scratch is not a
demonstration of skill"), scores the delta from a declared fork commit, and treats keeping an upstream agent loop
as an eligibility failure. A team that cannot explain its submission on the 10-minute call is replaced.

[Our survey](../research/upstream-editors.md) of the four suggested projects found:

- **Continue** is read-only and no longer maintained, but has real per-block accept and reject, about 1,300 lines
  in `extensions/vscode/src/diff/vertical`, tied into its own streaming pipeline.
- **Roo Code** was archived on 15 May 2026.
- **Cline** is active, at about 4,450 files, with its agent core in `sdk/` shared by every client.
- **opencode** has a small `sdks/vscode` package, with its real interface elsewhere.

## Decision

Start from scratch, using VS Code's own APIs and ordinary dependencies. The README declares "from scratch".

## Why

- **The loop is replaced anyway.** In these projects the editor side is written around their own loop, so a fork
  means removing and rewiring a deep dependency, across thousands of files, in 16 days.
- **The hard scored parts are ours to write regardless.** Retrieval, approval-driven review, rollback and fallback
  are specific to TrueForge's event model.
- **A small codebase can be explained.** Everyone on the call needs to be able to walk through it.
- **The risky part turned out small.** Per-hunk review is about 500 lines here, including its logic.

## What it gives up

- Upstream polish: streaming diffs into the live buffer, mature webview UI.
- The review editor is a merged preview rather than the live document ([ADR 0003](0003-approval-drives-review.md)).

## If this is revisited

The middle path is to copy specific files, such as Continue's vertical diff, under Apache-2.0. That keeps most of
the benefit, but the code must be declared and keep its licence and attribution, and the README's "from scratch"
must change. A licence violation is an eligibility failure.
