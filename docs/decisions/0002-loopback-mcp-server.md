# 0002: The extension hosts an MCP server on loopback

**Status:** Implemented. Live check pending: `npm run smoke` covers it.

## Context

The eligibility gate requires editor capabilities to be MCP tools. TrueForge only connects to remote MCP servers
over HTTP, and by default its outbound guard denies loopback addresses, which would block any server on this
machine (source in [the findings](../research/trueforge-findings.md)).

## Decision

The extension host runs a Streamable HTTP MCP server on `127.0.0.1`, on a random port, with a bearer token created
at activation, and upserts it into TrueForge as `synapse-editor`. `npm run trueforge` starts TrueForge with
`OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'`, which local model endpoints need as well.

The server is stateless, with one short-lived MCP server per request, and it checks the `Host` header so a web page
cannot reach it through DNS rebinding.

## What it gives up

- **One window at a time.** Each window upserts the same name, so the last one opened wins.
- **Starting TrueForge another way needs the same variable.** Running a bare `npx` gives an agent with no tools.
  `Synapse: Check TrueForge Setup` detects this and says what to do.
