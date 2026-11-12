# Agent

What runs on TrueForge. The brief requires the repository to contain the agent definition used, and these are it.

| Path | What it is |
| --- | --- |
| `definitions/coder.json` | The agent-mode agent |
| `definitions/inline-edit.json` | The single-file agent behind the inline edit keybinding |
| `models.example.json` | Example model configuration to copy to `models.json`, which git ignores |
| `models.mock.example.json` | The scripted model, for working with no API key |
| `models.task-c.example.json` | A broken primary with a fallback, for rehearsing Task C |
| `scripts/start-trueforge.mjs` | `npm run trueforge` starts TrueForge able to reach the extension |
| `scripts/setup.mjs` | `npm run setup:models` registers providers from a config file |
| `scripts/smoke.mjs` | `npm run smoke` checks the behaviour we rely on, with no API key |

## Definitions

They use TrueForge's wire format ([reference](https://trueforge.dev/create-agent/overview)), with two differences: there is **no model**, which comes
from the `synapse.models` setting at run time, and there is a `description` field. The extension validates them strictly and builds each session from
them, so an unknown field is an error, not something silently ignored.

Three settings are deliberate. Changing them affects eligibility or scoring:

- `require_approval_for_tools` names each writing tool, because `@write` skips unlabelled tools ([ADR 0003](../docs/decisions/0003-approval-drives-review.md)).
- `large_tool_response` is off, because without a sandbox it would hide results from the agent ([ADR 0007](../docs/decisions/0007-tools-bound-their-own-output.md)).
- `ask_user_questions` is off, because a single request should run to completion, and the extension does not handle that pause.

## Model configuration

```json
{
  "providers": [{ "type": "custom", "name": "my-endpoint", "base_url": "http://127.0.0.1:11434/v1", "models": [] }],
  "chain": ["my-endpoint/my-model"]
}
```

Each provider is a TrueForge provider manifest ([reference](https://trueforge.dev/models)), plus `api_key_env`, which names an environment variable holding
the key. A key written in the file itself is refused. For custom providers, set `context_length`, because TrueForge's compaction depends on it.
