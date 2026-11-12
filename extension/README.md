# Synapse extension

The VS Code extension. See the [repository README](../README.md) for setup, and [the architecture](../docs/architecture/README.md) for
how it fits together.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/core/` | All decisions: runs, review, journal, retrieval, fallback. No `vscode` imports |
| `src/mcp/` | The MCP server and tools the agent calls. No `vscode` imports |
| `src/trueforge/` | The SDK adapter and setup checks |
| `src/editor/` | Everything that touches VS Code: panel, review editor, workspace access, wiring |
| `media/` | The panel's script and styles. Plain JavaScript and CSS, using the editor's theme variables |

Keep logic out of `src/editor/`. It has no automated tests, while everything else does.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `synapse.models` | `[]` | Ordered models as configured in TrueForge. The first is primary, the rest are fallbacks |
| `synapse.trueforgeUrl` | `http://localhost:8790` | The TrueForge server |
| `synapse.retry.attemptsPerModel` | `2` | Tries per model on a transient failure |
| `synapse.retry.backoffMs` | `1000` | Base retry delay, doubling each time |
| `synapse.context.budgetTokens` | `8000` | Budget for mentioned and retrieved code in a run's first message |

## Accessibility

Every action works from the keyboard. The panel uses a live log region, a labelled input and an ARIA combobox for mentions. Review lines say
"removed" or "added" in text rather than relying on color, and styling follows the active theme, including high contrast.
