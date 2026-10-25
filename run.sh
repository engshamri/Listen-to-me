#!/usr/bin/env sh
# Listen to me - launcher for Linux, macOS and WSL.
# Usage: ./run.sh [server.py options]     (chmod +x run.sh once)
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py "$@"
elif command -v python >/dev/null 2>&1; then
  exec python server.py "$@"
else
  echo "[X] Python 3 is not installed. Install it with your package manager (e.g. sudo apt install python3 python3-pip)."
  exit 1
fi
