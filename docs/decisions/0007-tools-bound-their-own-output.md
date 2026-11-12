# 0007: Tools bound their own output, with no sandbox

**Status:** Implemented.

## Context

TrueForge offloads large MCP tool results to a sandbox file, leaving a preview. Offloading is on by default, the sandbox is
off by default, and the brief says the sandbox is not required. Reading `LargeToolResponse.ts`, a large MCP result is
replaced by its preview whether or not a sandbox exists, but only saved when one does. So with no sandbox, the agent would
get a preview of a file it can never read in full.

## Decision

- Definitions set `large_tool_response.enabled: false` and leave the sandbox off.
- Tools bound their own output, below the 6,000-token threshold: reads stop at 20,000 characters and say where to continue,
  search stops at 50 results, retrieval is capped, and command output is clipped at both ends.
- The context features used are the ones that need no sandbox: subagents, deferred tool loading and compaction.

## What it gives up

Skills and Code Mode, which require a sandbox. B4 needs only one context-engineering feature, so this costs no points.
Commands run through `run_command` on the user's machine after approval, rather than in an isolated environment.
