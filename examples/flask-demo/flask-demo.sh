#!/usr/bin/env bash
# Prepares and verifies the competition's fixed tasks on the pinned Flask checkout.
#
#   flask-demo.sh setup      clone Flask 3.1.3 into .cache/flask-demo and create its virtualenv
#   flask-demo.sh verify-a   the on-screen check for Task A
#   flask-demo.sh verify-b   the on-screen checks for Task B
#   flask-demo.sh verify-c   the on-screen check for Task C
#   flask-demo.sh reset      discard all changes in the demo checkout, ready for another take
#
# Set FLASK_DEMO_DIR to use a folder other than .cache/flask-demo.
set -euo pipefail

COMMIT=22d924701a6ae2e4cd01e9a15bbaf3946094af65 # pallets/flask tag 3.1.3
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DEMO="${FLASK_DEMO_DIR:-$ROOT/.cache/flask-demo}"

need_checkout() {
  if [[ ! -d "$DEMO/.venv" ]]; then
    echo "The demo checkout is not set up yet. Run: npm run demo:flask -- setup" >&2
    exit 1
  fi
}

run() {
  echo "\$ $*"
  "$@"
}

case "${1:-setup}" in
  setup)
    # Pressing F5 before setup makes VS Code open this path as a new file, which then blocks setup.
    if [[ -e "$DEMO" && ! -d "$DEMO" ]]; then
      echo "$DEMO is a file, not the Flask checkout. It was probably created by pressing F5 before setup." >&2
      echo "Look at it, delete it, and run setup again." >&2
      exit 1
    fi
    if [[ ! -d "$DEMO/.git" ]]; then
      mkdir -p "$DEMO"
      git -C "$DEMO" init -q
      git -C "$DEMO" fetch -q --depth 1 https://github.com/pallets/flask.git "$COMMIT"
      git -C "$DEMO" checkout -q FETCH_HEAD
    fi
    # Keeps Task C's `git status` honest: none of these are changes the agent made.
    for pattern in '.venv/' '.vscode/' '__pycache__/' '.pytest_cache/' '*.egg-info/'; do
      grep -qxF "$pattern" "$DEMO/.git/info/exclude" || echo "$pattern" >> "$DEMO/.git/info/exclude"
    done
    python3 -m venv "$DEMO/.venv"
    # Install the versions Flask's own lockfile pins for this release. The newest pytest no longer has
    # `_pytest.monkeypatch.notset`, which tests/test_cli.py imports, so Task B's check would fail before
    # the agent changed anything.
    # The lockfile resolves per Python version, so evaluate its markers for this interpreter.
    "$DEMO/.venv/bin/python" - "$DEMO/uv.lock" > "$DEMO/.venv/constraints.txt" <<'PY'
import sys, tomllib
from pip._vendor.packaging.markers import Marker
wanted = {"pytest", "click", "werkzeug", "jinja2", "markupsafe", "itsdangerous", "blinker", "python-dotenv", "asgiref", "iniconfig", "pluggy", "packaging"}
for package in tomllib.load(open(sys.argv[1], "rb"))["package"]:
    markers = package.get("resolution-markers")
    if package["name"] in wanted and (not markers or any(Marker(marker).evaluate() for marker in markers)):
        print(f'{package["name"]}=={package["version"]}')
PY
    "$DEMO/.venv/bin/pip" install --quiet -c "$DEMO/.venv/constraints.txt" -e "$DEMO" pytest python-dotenv asgiref
    echo "Flask $(git -C "$DEMO" rev-parse --short=8 HEAD) is ready at $DEMO"
    echo "Open that folder in the Extension Development Host. Pressing F5 in this repo does it for you."
    ;;
  verify-a)
    need_checkout
    cd "$DEMO"
    echo '$ FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"'
    FLASK_DEBUG=off .venv/bin/python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
    ;;
  verify-b)
    need_checkout
    cd "$DEMO"
    export PATH="$DEMO/.venv/bin:$PATH"
    run pytest tests/test_cli.py -q
    # With an app loaded, the help lists the built-in commands without a "could not locate" error.
    export FLASK_APP="$HERE/demo_app.py"
    echo "\$ FLASK_APP=$FLASK_APP flask --help"
    flask --help
    echo "\$ FLASK_APP=$FLASK_APP flask config"
    flask config
    run git diff --stat
    ;;
  verify-c)
    need_checkout
    run git -C "$DEMO" status
    ;;
  reset)
    need_checkout
    git -C "$DEMO" checkout -q -- .
    git -C "$DEMO" clean -fdq
    echo "Demo checkout restored to Flask $(git -C "$DEMO" rev-parse --short=8 HEAD)."
    ;;
  *)
    sed -n '2,8p' "${BASH_SOURCE[0]}" >&2
    exit 1
    ;;
esac
