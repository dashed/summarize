#!/usr/bin/env bash
# setup-extension.sh — Set up the Summarize Chrome extension daemon with all
# dependencies (ffmpeg, yt-dlp, tesseract) and configure WSL Chrome cookies.
#
# Usage:
#   ./scripts/setup-extension.sh                  # reads token from existing daemon.json
#   ./scripts/setup-extension.sh --token <TOKEN>   # use explicit token
#
# Environment variables (optional — set before running):
#   OPENROUTER_API_KEY          — required for OpenRouter models
#   SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER — override cookie browser/path

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
bold='\033[1m'
green='\033[0;32m'
yellow='\033[0;33m'
red='\033[0;31m'
reset='\033[0m'

info()  { printf "${bold}[*]${reset} %s\n" "$*"; }
ok()    { printf "${green}[✓]${reset} %s\n" "$*"; }
warn()  { printf "${yellow}[!]${reset} %s\n" "$*"; }
fail()  { printf "${red}[✗]${reset} %s\n" "$*"; }
die()   { fail "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
TOKEN_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN_ARG="${2:-}"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
info "Checking prerequisites…"

command -v summarize >/dev/null 2>&1 || die "summarize CLI not found. Install it first: npm i -g @steipete/summarize"
ok "summarize CLI found: $(command -v summarize)"

command -v uv >/dev/null 2>&1 || die "uv not found. Install it first: curl -LsSf https://astral.sh/uv/install.sh | sh"
ok "uv found: $(command -v uv)"

# ---------------------------------------------------------------------------
# Step 1: Install system packages
# ---------------------------------------------------------------------------
info "Installing system packages (ffmpeg, tesseract)…"

PKGS_TO_INSTALL=()
dpkg -s ffmpeg >/dev/null 2>&1        || PKGS_TO_INSTALL+=(ffmpeg)
dpkg -s tesseract-ocr >/dev/null 2>&1  || PKGS_TO_INSTALL+=(tesseract-ocr)

if [[ ${#PKGS_TO_INSTALL[@]} -gt 0 ]]; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq "${PKGS_TO_INSTALL[@]}"
  ok "Installed: ${PKGS_TO_INSTALL[*]}"
else
  ok "ffmpeg and tesseract already installed"
fi

# ---------------------------------------------------------------------------
# Step 2: Install yt-dlp via uv
# ---------------------------------------------------------------------------
info "Installing yt-dlp via uv…"
uv tool install yt-dlp 2>/dev/null || uv tool upgrade yt-dlp 2>/dev/null || true

command -v yt-dlp >/dev/null 2>&1 || die "yt-dlp not found on PATH after install. Ensure ~/.local/bin is in PATH."
ok "yt-dlp installed: $(yt-dlp --version)"

# ---------------------------------------------------------------------------
# Step 3: Verify all tools
# ---------------------------------------------------------------------------
info "Verifying tools…"

for tool in ffmpeg ffprobe yt-dlp tesseract; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool → $(command -v "$tool")"
  else
    warn "$tool not found (optional: $(
      case "$tool" in
        ffprobe)   echo "part of ffmpeg, used for video probing" ;;
        tesseract) echo "OCR text extraction from slides" ;;
        *)         echo "required" ;;
      esac
    ))"
  fi
done

# ---------------------------------------------------------------------------
# Step 4: WSL Chrome cookies
# ---------------------------------------------------------------------------
is_wsl() { grep -qi 'microsoft\|wsl' /proc/version 2>/dev/null; }

# check_cookie_db — test whether a browser cookie DB is readable (not locked)
# Args: $1 = cookie DB path
# Returns 0 if readable, 1 if locked/missing
check_cookie_db() {
  local db="$1"
  [[ -f "$db" ]] || return 1
  # Try to open the SQLite DB; a locked file will error immediately
  if python3 -c "
import sqlite3, sys
try:
    conn = sqlite3.connect('file:${db}?mode=ro', uri=True, timeout=1)
    conn.execute('SELECT count(*) FROM cookies LIMIT 1')
    conn.close()
except Exception:
    sys.exit(1)
" 2>/dev/null; then
    return 0
  else
    return 1
  fi
}

if is_wsl; then
  info "WSL detected — configuring browser cookies…"

  if [[ -z "${SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER:-}" ]]; then
    # Discover Windows username
    WIN_USER="$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r\n')" || true

    if [[ -z "$WIN_USER" ]]; then
      # Fallback: scan /mnt/c/Users for browser installs
      for d in /mnt/c/Users/*/AppData/Local/Google/Chrome/User\ Data; do
        if [[ -d "$d" ]]; then
          WIN_USER="${d#/mnt/c/Users/}"; WIN_USER="${WIN_USER%%/*}"
          break
        fi
      done
    fi

    if [[ -z "$WIN_USER" ]]; then
      warn "Could not detect Windows username. Set SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER manually."
    else
      # Candidate browsers in preference order.
      # Each entry: "label:browser_flag:user_data_path:cookie_relative_path"
      CANDIDATES=(
        "Edge:edge:/mnt/c/Users/${WIN_USER}/AppData/Local/Microsoft/Edge/User Data:Default/Network/Cookies"
        "Chrome:chrome:/mnt/c/Users/${WIN_USER}/AppData/Local/Google/Chrome/User Data:Default/Network/Cookies"
        "Brave:brave:/mnt/c/Users/${WIN_USER}/AppData/Local/BraveSoftware/Brave-Browser/User Data:Default/Network/Cookies"
        "Firefox:firefox:/mnt/c/Users/${WIN_USER}/AppData/Roaming/Mozilla/Firefox/Profiles:cookies.sqlite"
      )

      CHOSEN=""
      for entry in "${CANDIDATES[@]}"; do
        IFS=: read -r label browser_flag user_data cookie_rel <<< "$entry"

        # Check the User Data dir exists
        if [[ ! -d "$user_data" ]]; then
          continue
        fi

        COOKIE_DB="${user_data}/${cookie_rel}"

        # Firefox profiles use a wildcard — find the default profile
        if [[ "$browser_flag" == "firefox" ]]; then
          COOKIE_DB=""
          for profile_dir in "$user_data"/*.default-release "$user_data"/*.default; do
            if [[ -f "${profile_dir}/${cookie_rel}" ]]; then
              COOKIE_DB="${profile_dir}/${cookie_rel}"
              break
            fi
          done
          [[ -z "$COOKIE_DB" ]] && continue
        fi

        if [[ ! -f "$COOKIE_DB" ]]; then
          info "$label found but no cookie DB at: $COOKIE_DB"
          continue
        fi

        # Test if the DB is readable (not locked by a running browser)
        if check_cookie_db "$COOKIE_DB"; then
          CHOSEN="${browser_flag}:${user_data}"
          ok "$label cookies are accessible (not locked)"
          break
        else
          warn "$label cookie DB is locked (browser is running). Skipping."
          warn "  → Close $label completely (including system tray) to use it."
        fi
      done

      if [[ -n "$CHOSEN" ]]; then
        export SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER="$CHOSEN"
        ok "Using cookies: $SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER"
      else
        warn "No unlocked browser cookie DB found."
        warn "Either close your browser or set SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER manually."
        warn "Example: export SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER=\"edge:/mnt/c/Users/${WIN_USER}/AppData/Local/Microsoft/Edge/User Data\""
      fi
    fi
  else
    ok "Cookie config already set: $SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER"
  fi
else
  info "Not WSL — skipping Windows browser cookie setup"
  if [[ -z "${SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER:-}" ]]; then
    warn "SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER not set. Age-restricted videos may fail."
    warn "Set it to your browser, e.g.: export SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER=chrome"
  fi
fi

# ---------------------------------------------------------------------------
# Step 5: Check API key
# ---------------------------------------------------------------------------
if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
  ok "OPENROUTER_API_KEY is set"
else
  warn "OPENROUTER_API_KEY is not set. OpenRouter models will not work."
  warn "Set it before running this script: export OPENROUTER_API_KEY=sk-or-..."
fi

# ---------------------------------------------------------------------------
# Step 6: Resolve daemon token
# ---------------------------------------------------------------------------
DAEMON_CONFIG="$HOME/.summarize/daemon.json"
TOKEN=""

if [[ -n "$TOKEN_ARG" ]]; then
  TOKEN="$TOKEN_ARG"
  info "Using token from --token argument"
elif [[ -f "$DAEMON_CONFIG" ]]; then
  TOKEN="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['token'])" "$DAEMON_CONFIG" 2>/dev/null)" || true
  if [[ -n "$TOKEN" ]]; then
    info "Read token from existing $DAEMON_CONFIG"
  fi
fi

if [[ -z "$TOKEN" ]]; then
  die "No daemon token found. Run with: $0 --token <TOKEN>"
fi

# ---------------------------------------------------------------------------
# Step 7: Reinstall daemon
# ---------------------------------------------------------------------------
info "Installing daemon (captures env snapshot)…"
summarize daemon install --token "$TOKEN"
ok "Daemon installed"

# ---------------------------------------------------------------------------
# Step 8: Verify daemon
# ---------------------------------------------------------------------------
info "Verifying daemon is running…"
sleep 1

PORT="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('port', 8787))" "$DAEMON_CONFIG" 2>/dev/null || echo 8787)"
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/v1/health" 2>/dev/null)" || true

if [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "200" ]]; then
  ok "Daemon is running on port $PORT (HTTP $HTTP_CODE)"
else
  warn "Daemon may not be running (HTTP $HTTP_CODE). Check: journalctl --user -u summarize-daemon -n 20"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
info "Setup complete! Env vars captured in $DAEMON_CONFIG:"
python3 -c "
import json, sys
cfg = json.load(open(sys.argv[1]))
env = cfg.get('env', {})
for k in sorted(env):
    v = env[k]
    display = (v[:40] + '…') if len(v) > 40 else v
    if 'KEY' in k or 'TOKEN' in k:
        display = v[:8] + '…' + v[-4:]
    print(f'  {k}={display}')
" "$DAEMON_CONFIG"

echo ""
ok "Next: open Chrome extension side panel → select 'Video + Slides' on a video page."
