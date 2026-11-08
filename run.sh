#!/usr/bin/env bash
# EditVerse one-step setup and launcher.
#
#   ./run.sh              check prerequisites, set up the Gemini key, start the app
#   ./run.sh --test       run the full Python + JS test suites and the evaluation
#   ./run.sh --no-open    start the app without opening a browser
#   ./run.sh --help       show this help
#
# The backend uses only the Python standard library, so there is nothing to
# install. The Gemini API key is read from your environment or from a local,
# git-ignored `.env` file. It is never printed, logged or sent to the browser.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

OPEN_BROWSER=1
RUN_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --test) RUN_TESTS=1 ;;
    --no-open) OPEN_BROWSER=0 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=""; G=""; Y=""; R=""; N=""; fi
ok()   { echo "${G}ok${N}    $*"; }
warn() { echo "${Y}note${N}  $*"; }
die()  { echo "${R}error${N} $*" >&2; exit 1; }

echo "${B}EditVerse${N}: checking your machine"

# --- Prerequisites -----------------------------------------------------------
PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 \
     && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    PY="$candidate"; break
  fi
done
[ -n "$PY" ] || die "Python 3.9+ is required. Install it from https://www.python.org/downloads/ and re-run."
ok "Python $("$PY" -c 'import platform; print(platform.python_version())')"

command -v git >/dev/null 2>&1 || die "Git is required (EditVerse stores history in a Git repository). Install it from https://git-scm.com/downloads and re-run."
ok "$(git --version)"

if command -v node >/dev/null 2>&1; then
  ok "Node $(node --version) (only needed for --test)"
elif [ "$RUN_TESTS" = 1 ]; then
  die "Node.js is required to run the JS tests. Install it from https://nodejs.org/ and re-run."
else
  warn "Node.js not found. That is fine: it is only needed for ./run.sh --test."
fi

# --- Tests -------------------------------------------------------------------
if [ "$RUN_TESTS" = 1 ]; then
  echo; echo "${B}Python tests${N} (about 100 seconds)"
  STORE_DB_PATH=:memory: "$PY" -m unittest discover -s tests
  echo; echo "${B}JS tests${N}"
  for t in tests/test_*.js; do node "$t" >/dev/null && ok "$t"; done
  echo; echo "${B}Gate evaluation${N}"
  "$PY" evaluation.py
  exit 0
fi

# --- Gemini key --------------------------------------------------------------
# Reads GEMINI_API_KEY=... from .env without executing the file.
if [ -z "${GEMINI_API_KEY:-}" ] && [ -f .env ]; then
  key_line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?GEMINI_API_KEY=' .env | tail -n 1 || true)"
  if [ -n "$key_line" ]; then
    value="${key_line#*=}"
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
    export GEMINI_API_KEY="$value"
    ok "Gemini key loaded from .env"
  fi
elif [ -n "${GEMINI_API_KEY:-}" ]; then
  ok "Gemini key found in your environment"
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  if [ -t 0 ]; then
    echo
    echo "The research agent needs a Gemini API key (get one at https://aistudio.google.com/)."
    echo "Press Enter to skip: everything except the agent still works."
    read -r -s -p "GEMINI_API_KEY (input hidden): " entered || true
    echo
    if [ -n "${entered:-}" ]; then
      export GEMINI_API_KEY="$entered"
      read -r -p "Save it to .env for next time? (.env is git-ignored) [y/N] " save || true
      if [[ "${save:-}" =~ ^[Yy]$ ]]; then
        if git check-ignore -q .env 2>/dev/null; then
          ( umask 077; printf "GEMINI_API_KEY=%s\n" "$entered" > .env )
          ok "Saved to .env (permissions 600)"
        else
          warn ".env is not git-ignored in this checkout, so I did not save it. Keep the key in your shell instead."
        fi
      fi
    fi
  fi
  [ -n "${GEMINI_API_KEY:-}" ] || warn "No Gemini key: the agent will report 'not configured'. Manual edits, history, diff, merge, 3D and ESMFold still work."
fi

# --- Port --------------------------------------------------------------------
PORT="${PORT:-8000}"
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65000 ] \
  || die "PORT must be a number between 1024 and 65000 (got '$PORT')."
port_free() { "$PY" - "$1" <<'PYEOF'
import socket, sys
s = socket.socket()
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(1)
finally:
    s.close()
PYEOF
}
if ! port_free "$PORT"; then
  requested="$PORT"
  for candidate in $(seq $((PORT + 1)) $((PORT + 20))); do
    if port_free "$candidate"; then PORT="$candidate"; break; fi
  done
  [ "$PORT" != "$requested" ] || die "Ports $requested to $((requested + 20)) are all busy. Free one or set PORT=<number>."
  warn "Port $requested is busy (an older EditVerse server?). Using $PORT instead."
fi
export PORT
URL="http://127.0.0.1:$PORT"

# --- Launch ------------------------------------------------------------------
echo
echo "${B}Starting EditVerse${N} on $URL  (Ctrl+C to stop)"
"$PY" backend/server.py &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

ready=0
for _ in $(seq 1 40); do
  kill -0 "$SERVER_PID" 2>/dev/null || die "The server stopped during startup. Check the messages above."
  if "$PY" -c "import urllib.request,sys; urllib.request.urlopen('$URL/', timeout=1)" 2>/dev/null; then ready=1; break; fi
  sleep 0.25
done
[ "$ready" = 1 ] || die "The server did not respond at $URL."
ok "Ready: $URL"

if [ "$OPEN_BROWSER" = 1 ]; then
  if command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
  fi
fi

wait "$SERVER_PID"
