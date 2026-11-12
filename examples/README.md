# Examples

## Flask demo

Everything for the [fixed tasks](../docs/competition/fixed-tasks.md), on the pinned Flask 3.1.3 in `.cache/flask-demo`.

| Command | What it does |
| --- | --- |
| `npm run demo:flask -- setup` | Clones Flask at the pinned commit and creates its virtualenv |
| `npm run demo:flask -- verify-a` | Task A's on-screen check |
| `npm run demo:flask -- verify-b` | Task B's checks, including the masked JSON from `demo_app.py` |
| `npm run demo:flask -- verify-c` | Task C's `git status` |
| `npm run demo:flask -- reset` | **Discards all changes in the demo checkout**, ready for another take |

The extension runs commands with the workspace's `.venv` on the `PATH`, so the agent's `pytest` uses this virtualenv.

## Mock model

A scripted OpenAI-compatible model with no key, no cost and the same behaviour every time. Use it to work on the editor side.

```bash
npm run mock-model
```

```bash
npm run setup:models -- --config agent/models.mock.example.json
```

Then set `"synapse.models": ["mock/scripted"]`. In agent mode it streams a fixed reply. For inline edit it proposes a fixed edit, so the whole review flow can
be tried. It does nothing clever, so use a real model to check the agent's judgement.
