# 0006: Budgeted lexical retrieval, not embeddings

**Status:** Implemented. Strategy details are in [context-strategy.md](../architecture/context-strategy.md).

## Context

B1 is worth 15 points. Retrieval has to work with any model on the organisers' choice of machine, and a hosted backend,
database or deployed service is out of scope. The extension must not call a provider directly, which rules out
calling an embeddings API from it.

## Decision

Deterministic lexical retrieval: BM25 over definition-aware chunks, rarity-weighted path matches, and promotion of the
tests and docs that travel with a source file, spent within a token budget and explained in a visible ledger.

## Why

- No provider, index service, language server or setup is needed, so it behaves the same everywhere.
- It is deterministic, so it can be held in place by a test on the real Flask repository, which runs in CI with no key.
- About 100 ms on Flask, so it can run before every request.
- Every choice can be explained in plain words, which is what B1 asks to see on screen.

## What it gives up

Semantic matching: a request worded unlike the code can miss. The agent can still search, and subagents can explore.
Local embeddings could be added later as one more ranking signal, without a service, if real use shows the need.
