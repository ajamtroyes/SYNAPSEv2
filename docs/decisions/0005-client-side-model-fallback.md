# 0005: Model fallback lives in the client, over inline sessions

**Status:** Implemented. Live check pending: `npm run smoke` covers the model swap.

## Context

B3's top anchor is "automatic fallback to a second configured model with no user action, workspace unchanged".
TrueForge runs one model per agent. Automatic model selection is listed as planned, and we found no fallback setting.

## Decision

The extension holds an ordered chain in `synapse.models`, using only models configured in TrueForge. When a turn ends in
error, it retries with backoff, then calls `PATCH /sessions/{id}` to replace the session's agent with the same definition
on the next model, and starts a new turn. Auth failures skip the retries.

**Sessions are inline** (`agent: { spec }`), built from `agent/definitions/*.json`, because the source shows PATCH can only
replace the agent on inline sessions: named ones are rejected with 422.

## Why this stays eligible

The extension still never calls a provider. It only chooses which TrueForge-configured model the session uses, and every
call goes through TrueForge.

## What it gives up

- **Named agents are not used,** so definitions do not appear in TrueForge's agent library. They are still in the
  repository, as the brief requires, and each session records its spec.
- **Failure classification reads the error text,** because that is what the turn exposes. It may need adjusting once the
  smoke test shows the real messages. An unrecognised failure is treated as transient, which costs a retry but is safe.
- **The failed turn stays in the session's history,** so a resent request can appear twice. This is harmless to the model
  but visible in the session view.

## Round 2

A fallback chain in the harness itself would be a natural contribution, and TrueForge's roadmap points in that direction.
See [the backlog](../progress/backlog.md#round-2-preparation).
