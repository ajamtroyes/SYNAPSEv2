# The three fixed tasks

Every team demonstrates these on the same repository: **pallets/flask, tag 3.1.3, commit `22d92470`**.
It is about 17,000 lines of Python across `src` and `tests` (17,019 when we counted). The wording will
not change, and we may rehearse as often as we like.

Prepare and check them with:

```bash
npm run demo:flask -- setup
```

## Task A: inline edit (single file)

**Do:** Open `src/flask/helpers.py`, select the function `get_debug_flag`, and instruct:

> Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.

Review and accept the diff.

**Verify on screen:** show that this prints `False`.

```bash
FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
```

Shortcut: `npm run demo:flask -- verify-a`

## Task B: agent mode (three or more files, none named)

**Do:** In the agent panel, with no files mentioned, instruct:

> Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "\*\*\*". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.

Review the hunks and accept. Show the TrueForge session for this run.

**Verify on screen:** the diff must touch at least three files. Run the test, then run the new command
against any Flask app and show the masked JSON.

```bash
pytest tests/test_cli.py -q
```

Shortcut: `npm run demo:flask -- verify-b`, which also uses [the demo app](../../examples/flask-demo/demo_app.py).

The files it should find, as confirmed by our golden test: `src/flask/cli.py`, `tests/test_cli.py`,
`docs/cli.rst`.

**Before accepting a model's diff in rehearsal, check it handles these.** We verified each on the pinned checkout. Do not put
them in the agent's instructions: that would be tuning to the test, and the organisers may give a different task live.

- `json.dumps(app.config)` fails, because `PERMANENT_SESSION_LIFETIME` is a `timedelta`. The command must serialise such values,
  for example with `default=str`, or the verification crashes on camera.
- With [the demo app](../../examples/flask-demo/demo_app.py), the keys to mask are `API_TOKEN`, `DATABASE_PASSWORD`, `SECRET_KEY`,
  `SECRET_KEY_FALLBACKS` (a list) and `STRIPE_KEY`.
- To appear in `flask --help`, the command must be registered next to `routes`, `run` and `shell` in `FlaskGroup.__init__`.
- Before any change, `pytest tests/test_cli.py -q` gives 58 passed, and `flask config` says "No such command".

**Use the test dependencies `setup` installs.** It pins the versions from Flask's own `uv.lock`. With the newest pytest,
`tests/test_cli.py` fails to import before the agent changes anything, because pytest removed `_pytest.monkeypatch.notset`.

## Task C: resilience

**Do:** Configure TrueForge with an unreachable endpoint or an invalid key, then repeat Task A.

**Verify on screen:** show that the editor stays responsive, the user sees a clear message (or a second
configured model takes over automatically), and `git status` shows no files changed.

Shortcut: `npm run demo:flask -- verify-c`

> **Trap:** if a fallback model takes over and you accept its diff, `git status` will show a change and the
> verification fails. See [the demo script](demo-script.md#task-c).
