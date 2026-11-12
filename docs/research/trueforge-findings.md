# TrueForge findings

What we rely on, and how we know it. Read from the repository at commit `9c116a98` (3 November 2026), matching npm version
`0.183.0`. Paths are relative to that repository.

**Verified how:** *Docs* means stated in the documentation. *Source* means read in the code. Neither means it has been seen
running. **Nothing here has been observed against a live server yet.** `npm run smoke` tests each row marked with ✓ below, and
`npm run smoke -- --write` saves its results to `docs/research/smoke-results.md`. Update this note once it has run.

## Running it

| Fact | Source | Smoke |
| --- | --- | --- |
| `npx @truefoundry/trueforge@latest` runs local mode on port 8790, with SQLite and no login. Requires Node 22.14 or newer | Docs: `docs/quickstart.mdx` | |
| Local mode is for this machine only, and should stay on localhost | Docs: `README.md` | |
| `GET /healthz` returns the status and version | Source: `packages/trueforge/src/app.ts:391` | ✓ |

## Reaching MCP servers and local models

| Fact | Source | Smoke |
| --- | --- | --- |
| Only remote MCP servers are supported, over `streamable-http` or `sse`, with no auth, header auth or OAuth | Docs: `docs/mcp-servers.mdx`; `api/use-agent.mdx` | ✓ |
| The outbound guard denies `127.0.0.0/8` and other private ranges, plus names without a dot such as `localhost`. It covers MCP URLs and model base URLs | Source: `packages/trueforge-core/src/core/util/ssrfGuard.ts:77-110, 162-178` | ✓ |
| `OUTBOUND_URL_ALLOWED_HOSTS`, a JSON array, exempts hosts. `NETWORK_POLICY_ENABLED=false` turns the guard off entirely | Source: `packages/trueforge/src/config.ts:856-861`, `.env.example` | ✓ |
| One MCP request is limited to two minutes by default (`MCP_REQUEST_TIMEOUT_MS`), and tool calls are not retried | Source: `config.ts:902`, `core/util/outboundFetch.ts` | |

## Turns and events

| Fact | Source | Smoke |
| --- | --- | --- |
| A stream opens with `turn.created` and closes with `turn.done`, whose status is `done`, `cancelled` or `error` | Docs: `docs/api/use-agent.mdx` | ✓ |
| Tokens arrive as `model.message.delta`, merged into a base `model.message` by id | Docs: `docs/api/overview.mdx` | ✓ |
| Creating a new turn cancels any turn running in that session | Docs: `docs/api/use-agent.mdx` | |
| Default SDK timeout is 60 seconds, so long streams must raise it | Docs: `docs/api/quickstart.mdx` | |

## Approvals

| Fact | Source | Smoke |
| --- | --- | --- |
| `require_approval_for_tools` defaults to `@write` and `@destructive`, which **skip tools the server did not label**. Name tools to be sure | Docs: `docs/create-agent/overview.mdx` | ✓ |
| A pause ends the turn. Resume with a new turn holding `user.tool_approval` items, which cannot be mixed with a user message | Docs: `docs/api/use-agent.mdx` | ✓ |
| A resume must answer every pending approval for that thread | Source: `core/runtime/AgentThread.ts:377` | |
| Subagent tool calls still pause for approval, on their own `thread_id`. Subagents cannot ask questions | Docs: `docs/key-features/subagents.mdx` | |
| A pending call's name and arguments are in the `model.message` named by `source_event_id` | Docs: `docs/api/use-agent.mdx` | ✓ |
| A deferred call goes through the `call_tool` meta tool, with arguments `{ mcp_server, tool_name, input }`. `tool_info` resolves to the underlying tool, and approval still applies | Source: `core/runtime/DeferredTool.ts:45-49, 111-145, 303-323` | ✓ |

## Cancel and errors

| Fact | Source | Smoke |
| --- | --- | --- |
| Cancel aborts the model request but **waits for running MCP tool calls to finish**, so we kill commands ourselves. It is idempotent, and the stream ends with a terminal `turn.done` | Docs: `docs/api/use-agent.mdx` | ✓ |
| A cancelled state carries a reason: `client-cancelled`, `server-execution-timeout`, `cancelled-for-next-turn` or `abandoned` | Docs: `docs/api/use-agent.mdx` | ✓ |
| Model transport failures and some statuses are retried twice by default (`MODEL_HTTP_MAX_RETRIES`). **How a dead endpoint or bad key surfaces, and how long it takes, is exactly what the smoke test measures** | Source: `.env.example`, `core/util/ssrfGuard.ts:495-530` | ✓ |

## Fallback

| Fact | Source | Smoke |
| --- | --- | --- |
| Each agent uses one configured model. Automatic selection is only planned | Docs: `docs/models.mdx`, `docs/roadmap.mdx` | |
| `PATCH /sessions/{id}` can replace the agent on an inline session. On a named session the store rejects it with 422 | Source: `packages/trueforge/src/apis/sessions.ts:648-675` | ✓ |

## Context engineering

| Fact | Source | Smoke |
| --- | --- | --- |
| Subagents are on by default, isolated, one level deep, and return only their final result | Docs: `docs/key-features/subagents.mdx` | |
| `preload: false` is the default, exposing `list_tools`, `get_tool_info`, `get_tool_output_schema` and `call_tool`. `preload_tools` selects some to load eagerly | Docs: `docs/key-features/deferred-tool-loading.mdx` | ✓ |
| Compaction is on by default, at 80% of the model's context length, or at 50,000 tokens if that is unknown. **So set `context_length` on custom models** | Docs: `docs/key-features/overview.mdx` | |
| Skills and Code Mode require a sandbox, which is off by default | Docs: `docs/skills.mdx`, `docs/key-features/code-mode.mdx` | |
| **Without a sandbox, large MCP results become a preview the agent cannot read past** (default thresholds: 6,000 tokens per result, 10,000 combined). See [ADR 0007](../decisions/0007-tools-bound-their-own-output.md) | Source: `core/capabilities/builtins/LargeToolResponse.ts:195-222` | |

## Models

| Fact | Source | Smoke |
| --- | --- | --- |
| Catalog providers: `openai`, `anthropic`, `google-gemini`, `fireworks`, `together`, `moonshot`, `zai`, `alibaba`, plus `custom` for any OpenAI-compatible endpoint | Docs: `docs/models.mdx` | |
| Custom providers use `createOpenAICompatible`, so they call `/chat/completions` | Source: `core/llm/VercelAILLM.ts:9, 138` | ✓ |
| A model's full name is `provider/name`. Names must match `^[a-z][a-z0-9-]{0,62}[a-z0-9]$` | Source: `docs/openapi.json` (`ResourceName`) | ✓ |

## Showing the session

The Sessions view lists turns, tool calls, subagents, tokens and timing, and each session has a copyable ID
(`docs/sessions.mdx`). We did not find a stable deep link, so the panel offers **Copy session ID**. Open the UI at
`http://localhost:8790`. Check this before recording.

## Contributing, for Round 2

`CONTRIBUTING.md` asks that non-trivial work start with an issue, and says: "Please only submit pull requests for an issue when
you have received approval from a maintainer." Generated OpenAPI and SDK output must not be committed from forks.
