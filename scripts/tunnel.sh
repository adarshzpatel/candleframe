#!/usr/bin/env bash
# Share the dev server through a temporary Cloudflare quick tunnel.
#
#   scripts/tunnel.sh          # tunnels http://127.0.0.1:5173, starting Vite if needed
#   PORT=5199 scripts/tunnel.sh
#
# Prints a https://*.trycloudflare.com URL. Anyone with it can open the demo until you
# stop the script (Ctrl+C). The Host header is rewritten to localhost, which Vite allows.
set -euo pipefail
PORT="${PORT:-5173}"
cd "$(dirname "$0")/.."
if ! curl -sf "http://127.0.0.1:$PORT/" >/dev/null; then
  npx vite --host 127.0.0.1 --port "$PORT" --strictPort &
  trap 'kill $! 2>/dev/null' EXIT
  for _ in $(seq 50); do curl -sf "http://127.0.0.1:$PORT/" >/dev/null && break; sleep 0.2; done
fi
exec cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" --http-host-header localhost
