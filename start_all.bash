#!/usr/bin/env bash
# Starts the Security-Copilot v2 (SIH26106) backend plus the Next.js dashboard (the two
# long-running processes this project has — the extension isn't a process,
# it's loaded into Chrome separately, see extension/README.md). Run
# ./download_everything.bash first if you haven't set anything up yet.
#
# Usage:
#   ./start_all.bash                     # backend on :8010 + dashboard on :3000
#   PORT=8020 ./start_all.bash           # different backend port
#   WITH_DASHBOARD=0 ./start_all.bash    # backend only
#   DASHBOARD_PORT=3005 ./start_all.bash # dashboard on a different port
#   WITH_TUNNELS=1 ./start_all.bash      # also expose both publicly (ngrok +
#                                         # cloudflared) — needed for the Gmail
#                                         # add-on / auto-scanner, which run on
#                                         # Google's servers and can't reach
#                                         # localhost. OFF by default: this
#                                         # puts your unauthenticated dev
#                                         # backend on the public internet.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
DASHBOARD_DIR="$ROOT_DIR/dashboard"
VENV_DIR="$ROOT_DIR/.venv"
LOCAL_BIN_DIR="$ROOT_DIR/.local_bin"

# Ports 8000/8001 are commonly already taken by other local projects — this
# project defaults to 8010 for exactly that reason. Override with:
#   PORT=8020 ./start_all.bash
PORT="${PORT:-8010}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"
WITH_DASHBOARD="${WITH_DASHBOARD:-1}"
WITH_TUNNELS="${WITH_TUNNELS:-0}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[ -d "$VENV_DIR" ] || die ".venv not found at $VENV_DIR — run ./download_everything.bash first."

cd "$BACKEND_DIR"

[ -f ".env" ] || die "backend/.env not found — run ./download_everything.bash first, then fill in OPENROUTER_API_KEY."

# Resolve the venv's interpreter by absolute path and invoke uvicorn through it
# (Windows/git-bash uses Scripts/, Linux/macOS bin/). We don't rely on `activate`
# rewriting PATH — it silently no-ops when another venv is already active in the
# parent shell (e.g. a `(.venv)` cmd prompt).
if   [ -x "$VENV_DIR/Scripts/python.exe" ]; then VENV_PY="$VENV_DIR/Scripts/python.exe"
elif [ -x "$VENV_DIR/bin/python" ];         then VENV_PY="$VENV_DIR/bin/python"
else die "Could not find the venv Python under $VENV_DIR (looked in Scripts/ and bin/)."
fi

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  exec 3>&-
  die "Something is already listening on 127.0.0.1:$PORT (likely an unrelated project — this repo defaults to 8010 to avoid the usual 8000/8001 collisions). Stop it first, or run with PORT=<free-port> ./start_all.bash."
fi

if ! grep -qE '^OPENROUTER_API_KEY=.+' .env; then
  printf '\033[1;33m!! No OPENROUTER_API_KEY set in backend/.env — the agent will fail on every case. Get a key at https://openrouter.ai/keys\033[0m\n'
fi

# Optional forensics data — everything works without it, just with less detail.
[ -f "data/intel/GeoLite2-City.mmdb" ]   || warn "No GeoLite2-City.mmdb in backend/data/intel/ — geolocation falls back to ip-api.com (45 req/min)."
grep -qE '^ABUSEIPDB_API_KEY=.+' .env   || warn "No ABUSEIPDB_API_KEY in backend/.env — origin-IP abuse scores are skipped."
if ! (exec 3<>"/dev/tcp/127.0.0.1/3310") 2>/dev/null; then
  # Best-effort, non-interactive (sudo -n never prompts for a password —
  # if it's not already installed/permitted, this just no-ops silently).
  command -v systemctl >/dev/null 2>&1 && sudo -n systemctl start clamav-daemon.socket clamav-daemon.service >/dev/null 2>&1 || true
fi
(exec 3<>"/dev/tcp/127.0.0.1/3310") 2>/dev/null || warn "No ClamAV daemon on 127.0.0.1:3310 — attachment signature scans are skipped (other attachment checks still run). Install it: ./download_everything.bash, or start it manually: sudo systemctl start clamav-daemon."

cleanup() {
  log "Shutting down"
  [ -n "${BACKEND_PID:-}" ]    && kill "$BACKEND_PID"    2>/dev/null || true
  [ -n "${DASH_PID:-}" ]       && kill "$DASH_PID"       2>/dev/null || true
  [ -n "${NGROK_PID:-}" ]      && kill "$NGROK_PID"      2>/dev/null || true
  [ -n "${CLOUDFLARED_PID:-}" ] && kill "$CLOUDFLARED_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# --- Public tunnels (Gmail add-on / auto-scanner) -------------------------
# Started BEFORE the backend (not after) — the dashboard's tunnel origin has
# to be known and added to CORS_ORIGINS before uvicorn starts, since that
# setting is only read once at backend startup. A tunnel process proxies by
# port and doesn't need its target already listening, so starting these
# first is safe.
# Google's servers (Apps Script triggers, the Gmail add-on) can't reach
# localhost, so the Gmail integration needs real public URLs for both the
# backend and the dashboard. Two different tools because free-tier ngrok
# only allows one tunnel at a time; cloudflared's quick tunnels are
# separate and need no account. Both print a NEW random URL every run —
# copy them into the Apps Script project's BACKEND_URL / DASHBOARD_URL
# constants each time you restart this script.
BACKEND_TUNNEL_URL=""
DASHBOARD_TUNNEL_URL=""

if [ "$WITH_TUNNELS" = "1" ]; then
  if command -v ngrok >/dev/null 2>&1; then
    log "Starting ngrok tunnel for the backend (:$PORT)"
    ngrok http "$PORT" --log=stdout > /tmp/security-copilot-ngrok.log 2>&1 &
    NGROK_PID=$!
    for _ in $(seq 1 20); do
      BACKEND_TUNNEL_URL=$( (curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
        | grep -o '"public_url":"https://[^"]*"' | head -1 | sed 's/"public_url":"//;s/"$//') || true )
      [ -n "$BACKEND_TUNNEL_URL" ] && break
      sleep 0.5
    done
    if [ -z "$BACKEND_TUNNEL_URL" ]; then
      warn "ngrok started but no tunnel URL appeared within 10s — check /tmp/security-copilot-ngrok.log (ngrok needs 'ngrok config add-authtoken <token>' set up once, from https://dashboard.ngrok.com)."
    fi
  else
    warn "ngrok not found — skipping the backend tunnel. Install it (https://ngrok.com/download) to expose the backend for the Gmail add-on/auto-scanner."
  fi

  # cloudflared needs no account/auth for a "quick tunnel" — auto-downloaded
  # once into .local_bin/ (gitignored) if not already on PATH, so this stays
  # a one-command startup on a fresh machine.
  CLOUDFLARED_BIN="$(command -v cloudflared || true)"
  if [ -z "$CLOUDFLARED_BIN" ] && [ -x "$LOCAL_BIN_DIR/cloudflared" ]; then
    CLOUDFLARED_BIN="$LOCAL_BIN_DIR/cloudflared"
  fi
  if [ -z "$CLOUDFLARED_BIN" ]; then
    log "cloudflared not found — downloading it once into .local_bin/"
    mkdir -p "$LOCAL_BIN_DIR"
    if curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
        -o "$LOCAL_BIN_DIR/cloudflared" 2>/tmp/security-copilot-cloudflared-dl.log; then
      chmod +x "$LOCAL_BIN_DIR/cloudflared"
      CLOUDFLARED_BIN="$LOCAL_BIN_DIR/cloudflared"
    else
      warn "Could not download cloudflared automatically — skipping the dashboard tunnel. See /tmp/security-copilot-cloudflared-dl.log, or install it yourself: https://github.com/cloudflare/cloudflared"
    fi
  fi

  if [ -n "$CLOUDFLARED_BIN" ] && [ "$WITH_DASHBOARD" = "1" ]; then
    log "Starting cloudflared tunnel for the dashboard (:$DASHBOARD_PORT)"
    "$CLOUDFLARED_BIN" tunnel --url "http://localhost:$DASHBOARD_PORT" > /tmp/security-copilot-cloudflared.log 2>&1 &
    CLOUDFLARED_PID=$!
    for _ in $(seq 1 30); do
      DASHBOARD_TUNNEL_URL=$( (grep -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' /tmp/security-copilot-cloudflared.log 2>/dev/null | head -1) || true )
      [ -n "$DASHBOARD_TUNNEL_URL" ] && break
      sleep 0.5
    done
    [ -z "$DASHBOARD_TUNNEL_URL" ] && warn "cloudflared started but no tunnel URL appeared within 15s — check /tmp/security-copilot-cloudflared.log"
  fi
fi

# Let the dashboard's browser origin call the API — both the local dev
# origin (:3000) and, if active, the public dashboard tunnel's origin
# (without this, the browser's CORS preflight silently kills every POST
# the dashboard makes to the backend once it's viewed through the tunnel,
# while simpler GETs can appear to keep working — confirmed as the actual
# cause of a "could not reach backend" report that turned out to be this).
# Overrides config.py's default CORS list; the extension is still covered
# by the chrome-extension:// regex in api/app.py.
CORS_ORIGINS_DEFAULT="http://localhost,http://127.0.0.1,http://localhost:$DASHBOARD_PORT,http://127.0.0.1:$DASHBOARD_PORT"
[ -n "$DASHBOARD_TUNNEL_URL" ] && CORS_ORIGINS_DEFAULT="$CORS_ORIGINS_DEFAULT,$DASHBOARD_TUNNEL_URL"
export CORS_ORIGINS="${CORS_ORIGINS:-$CORS_ORIGINS_DEFAULT}"

log "Starting security-copilot backend on http://127.0.0.1:$PORT"
"$VENV_PY" -m uvicorn api.app:app --host 127.0.0.1 --port "$PORT" --reload &
BACKEND_PID=$!

# --- Dashboard (Next.js dev server) --------------------------------------
# NEXT_PUBLIC_API_BASE_URL points the dashboard at THIS backend's port (we run
# on 8010, not the dashboard's built-in :8000 default). A URL set in the
# dashboard's Settings page (localStorage) still overrides it per-browser.
# Started AFTER the tunnels above (not before) so that if a dashboard tunnel
# URL exists, its hostname can be passed as NEXT_ALLOWED_DEV_ORIGIN — Next.js
# dev mode otherwise silently blocks cross-origin requests for its own JS
# chunks/HMR socket when accessed through a tunnel instead of localhost.
if [ "$WITH_DASHBOARD" = "1" ]; then
  if command -v pnpm >/dev/null 2>&1; then
    if [ ! -d "$DASHBOARD_DIR/node_modules" ]; then
      log "Installing dashboard dependencies (first run)"
      (cd "$DASHBOARD_DIR" && pnpm install)
    fi
    DASHBOARD_TUNNEL_HOST=""
    [ -n "$DASHBOARD_TUNNEL_URL" ] && DASHBOARD_TUNNEL_HOST="${DASHBOARD_TUNNEL_URL#https://}"
    log "Starting dashboard on http://localhost:$DASHBOARD_PORT (API -> http://localhost:$PORT)"
    (cd "$DASHBOARD_DIR" && NEXT_PUBLIC_API_BASE_URL="http://localhost:$PORT" NEXT_ALLOWED_DEV_ORIGIN="$DASHBOARD_TUNNEL_HOST" pnpm dev --port "$DASHBOARD_PORT") &
    DASH_PID=$!
  else
    warn "pnpm not found — skipping the dashboard. Install pnpm (https://pnpm.io), or run it yourself: cd dashboard && NEXT_PUBLIC_API_BASE_URL=http://localhost:$PORT pnpm dev"
  fi
else
  warn "Dashboard disabled (WITH_DASHBOARD=0) — backend only."
fi

cat <<EOF

  Dashboard:         http://localhost:$DASHBOARD_PORT/   (the UI)
  Health check:      http://127.0.0.1:$PORT/health
  API docs:          http://127.0.0.1:$PORT/docs
  Try it:            upload backend/tests/fixtures/phish_paypal.eml under Email scans
  Extension:         load extension/dist/ as an unpacked extension in chrome://extensions
                      (run 'cd extension && npm run build' first if you haven't)
EOF

cat <<EOF
  Stop everything:   Ctrl+C
EOF

if [ "$WITH_TUNNELS" = "1" ]; then
  printf '\n\033[1;35m╔══════════════════════════════════════════════════════════════════╗\033[0m\n'
  printf '\033[1;35m║  PUBLIC TUNNELS — paste these into the Apps Script project now    ║\033[0m\n'
  printf '\033[1;35m╚══════════════════════════════════════════════════════════════════╝\033[0m\n'
  printf '  \033[1mCode.gs\033[0m   BACKEND_URL  = \033[1;32m%s\033[0m\n' "${BACKEND_TUNNEL_URL:-"(not available — see warnings above)"}"
  printf '  \033[1maddon.gs\033[0m DASHBOARD_URL = \033[1;32m%s\033[0m\n' "${DASHBOARD_TUNNEL_URL:-"(not available — see warnings above)"}"
  printf '  \033[2mThese change every time this script restarts — re-copy them then.\033[0m\n\n'
fi

# Wait on the backend; the trap tears down the dashboard too on exit.
wait "$BACKEND_PID"
