#!/usr/bin/env bash
set -euo pipefail

# -------------------------------------------------------------
# openclaw-second-brain installer (fully automated, idempotent)
#
# What this script does:
#   1) Auto-detect required paths and binaries
#   2) npm install + npm run build
#   3) Ensure conversations/ exists in OpenClaw workspace
#   4) Render launchd plists from templates (all placeholders)
#   5) Reload launch agents (bootout/bootstrap/kickstart)
#   6) Optionally configure Tailscale serve (if tailscale exists)
#   7) Verify app and launchd services
#   8) Print a setup summary and access URLs
# -------------------------------------------------------------

log() {
  printf "\n[%s] %s\n" "$(date '+%H:%M:%S')" "$*"
}

warn() {
  printf "\n[WARN] %s\n" "$*" >&2
}

die() {
  printf "\n[ERROR] %s\n" "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

expand_home() {
  # Expands ~ safely for paths provided via env vars.
  local input="$1"
  case "$input" in
    "~")
      printf '%s\n' "$HOME_DIR"
      ;;
    "~/"*)
      printf '%s\n' "$HOME_DIR/${input#~/}"
      ;;
    *)
      printf '%s\n' "$input"
      ;;
  esac
}

detect_sessions_dir() {
  # Finds the actual OpenClaw sessions directory dynamically.
  # Priority:
  #   1) OPENCLAW_SESSIONS_DIR env (if valid)
  #   2) ~/.openclaw/agents/main/sessions (if present)
  #   3) Any */sessions.json under ~/.openclaw/agents/**
  #   4) Any */sessions directory under ~/.openclaw/agents/**
  #   5) Fallback default path
  local explicit default_dir agents_root first_found json_path candidate

  explicit="${OPENCLAW_SESSIONS_DIR:-}"
  if [[ -n "$explicit" ]]; then
    explicit="$(expand_home "$explicit")"
    if [[ -d "$explicit" ]]; then
      printf '%s\n' "$explicit"
      return
    fi
  fi

  default_dir="$OPENCLAW_HOME/agents/main/sessions"
  if [[ -f "$default_dir/sessions.json" || -d "$default_dir" ]]; then
    printf '%s\n' "$default_dir"
    return
  fi

  agents_root="$OPENCLAW_HOME/agents"
  first_found=""

  if [[ -d "$agents_root" ]]; then
    while IFS= read -r -d '' json_path; do
      candidate="$(dirname "$json_path")"
      if [[ "$candidate" == "$default_dir" ]]; then
        printf '%s\n' "$candidate"
        return
      fi
      if [[ -z "$first_found" ]]; then
        first_found="$candidate"
      fi
    done < <(find "$agents_root" -type f -name 'sessions.json' -print0 2>/dev/null)

    if [[ -n "$first_found" ]]; then
      printf '%s\n' "$first_found"
      return
    fi

    while IFS= read -r -d '' candidate; do
      if [[ "$candidate" == "$default_dir" ]]; then
        printf '%s\n' "$candidate"
        return
      fi
      if [[ -z "$first_found" ]]; then
        first_found="$candidate"
      fi
    done < <(find "$agents_root" -type d -name 'sessions' -print0 2>/dev/null)
  fi

  if [[ -n "$first_found" ]]; then
    printf '%s\n' "$first_found"
  else
    printf '%s\n' "$default_dir"
  fi
}

render_plist() {
  # Renders one plist template by replacing all placeholders.
  # Also rewrites legacy hardcoded labels to per-user labels.
  local template_path="$1"
  local output_path="$2"

  "$PYTHON3_PATH" - "$template_path" "$output_path" <<'PY'
import os
import pathlib
import re
import sys

template_path, output_path = sys.argv[1], sys.argv[2]
text = pathlib.Path(template_path).read_text(encoding="utf-8")

replacements = {
    "__SECOND_BRAIN_REPO_PATH__": os.environ["REPO_DIR"],
    "__OPENCLAW_HOME__": os.environ["OPENCLAW_HOME"],
    "__OPENCLAW_WORKSPACE__": os.environ["OPENCLAW_WORKSPACE"],
    "__OPENCLAW_CONVERSATIONS_DIR__": os.environ["OPENCLAW_CONVERSATIONS_DIR"],
    "__OPENCLAW_SESSIONS_DIR__": os.environ["OPENCLAW_SESSIONS_DIR"],
    "__NPX_PATH__": os.environ["NPX_PATH"],
    "__PYTHON3_PATH__": os.environ["PYTHON3_PATH"],
    "__SECOND_BRAIN_PORT__": os.environ["SECOND_BRAIN_PORT"],
    "__SECOND_BRAIN_HOST__": os.environ["SECOND_BRAIN_HOST"],
    "__SECOND_BRAIN_LOG_PATH__": os.environ["SECOND_BRAIN_LOG_PATH"],
    "__CONVERSATION_LOGGER_LOG_PATH__": os.environ["CONVERSATION_LOGGER_LOG_PATH"],
    # Optional placeholders if templates add them later.
    "__SECOND_BRAIN_SERVICE_NAME__": os.environ["SECOND_BRAIN_SERVICE_NAME"],
    "__CONVERSATION_LOGGER_SERVICE_NAME__": os.environ["CONVERSATION_LOGGER_SERVICE_NAME"],
}

for token, value in replacements.items():
    text = text.replace(token, value)

# Backward-compatible replacement for current templates that hardcode labels.
text = text.replace("com.tars.second-brain", os.environ["SECOND_BRAIN_SERVICE_NAME"])
text = text.replace("com.tars.conversation-logger", os.environ["CONVERSATION_LOGGER_SERVICE_NAME"])

remaining = sorted(set(re.findall(r"__[A-Z0-9_]+__", text)))
if remaining:
    raise SystemExit(
        f"Unreplaced placeholders in {template_path}: {', '.join(remaining)}"
    )

pathlib.Path(output_path).write_text(text, encoding="utf-8")
PY
}

bootout_if_exists() {
  # Unloads a launchd service by label and/or plist path (best effort).
  local label="$1"
  local plist_path="${2:-}"

  launchctl bootout "gui/$USER_UID/$label" >/dev/null 2>&1 || true

  if [[ -n "$plist_path" ]]; then
    launchctl bootout "gui/$USER_UID" "$plist_path" >/dev/null 2>&1 || true
  fi
}


# ----------------------
# 1) Auto-detect paths
# ----------------------
HOME_DIR="${HOME:-$(cd ~ && pwd)}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="$(expand_home "${OPENCLAW_HOME:-$HOME_DIR/.openclaw}")"
OPENCLAW_WORKSPACE="$(expand_home "${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}")"
OPENCLAW_CONVERSATIONS_DIR="$(expand_home "${OPENCLAW_CONVERSATIONS_DIR:-$OPENCLAW_WORKSPACE/conversations}")"

NPX_PATH="$(command -v npx || true)"
PYTHON3_PATH="$(command -v python3 || true)"

[[ -n "$NPX_PATH" ]] || die "npx not found in PATH. Install Node.js/npm first."
[[ -n "$PYTHON3_PATH" ]] || die "python3 not found in PATH. Install Python 3 first."

OPENCLAW_SESSIONS_DIR="$(detect_sessions_dir)"

RAW_USER="${USER:-$(id -un)}"
USER_SLUG="$(printf '%s' "$RAW_USER" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
if [[ -z "$USER_SLUG" ]]; then
  USER_SLUG="uid$(id -u)"
fi

SECOND_BRAIN_SERVICE_NAME="com.${USER_SLUG}.second-brain"
CONVERSATION_LOGGER_SERVICE_NAME="com.${USER_SLUG}.conversation-logger"

LEGACY_SECOND_BRAIN_SERVICE_NAME="com.tars.second-brain"
LEGACY_CONVERSATION_LOGGER_SERVICE_NAME="com.tars.conversation-logger"

SECOND_BRAIN_PORT="${SECOND_BRAIN_PORT:-3333}"
SECOND_BRAIN_HOST="${SECOND_BRAIN_HOST:-0.0.0.0}"
SECOND_BRAIN_LOG_PATH="${SECOND_BRAIN_LOG_PATH:-/private/tmp/second-brain.log}"
CONVERSATION_LOGGER_LOG_PATH="${CONVERSATION_LOGGER_LOG_PATH:-/private/tmp/conversation-logger.log}"

SECOND_BRAIN_TEMPLATE="$REPO_DIR/launchd/com.tars.second-brain.plist.template"
CONVERSATION_LOGGER_TEMPLATE="$REPO_DIR/launchd/com.tars.conversation-logger.plist.template"

[[ -f "$SECOND_BRAIN_TEMPLATE" ]] || die "Missing template: $SECOND_BRAIN_TEMPLATE"
[[ -f "$CONVERSATION_LOGGER_TEMPLATE" ]] || die "Missing template: $CONVERSATION_LOGGER_TEMPLATE"

USER_UID="$(id -u)"
LAUNCH_AGENTS_DIR="$HOME_DIR/Library/LaunchAgents"
SECOND_BRAIN_PLIST_DEST="$LAUNCH_AGENTS_DIR/${SECOND_BRAIN_SERVICE_NAME}.plist"
CONVERSATION_LOGGER_PLIST_DEST="$LAUNCH_AGENTS_DIR/${CONVERSATION_LOGGER_SERVICE_NAME}.plist"
LEGACY_SECOND_BRAIN_PLIST_DEST="$LAUNCH_AGENTS_DIR/${LEGACY_SECOND_BRAIN_SERVICE_NAME}.plist"
LEGACY_CONVERSATION_LOGGER_PLIST_DEST="$LAUNCH_AGENTS_DIR/${LEGACY_CONVERSATION_LOGGER_SERVICE_NAME}.plist"

export REPO_DIR OPENCLAW_HOME OPENCLAW_WORKSPACE OPENCLAW_CONVERSATIONS_DIR OPENCLAW_SESSIONS_DIR
export NPX_PATH PYTHON3_PATH SECOND_BRAIN_PORT SECOND_BRAIN_HOST SECOND_BRAIN_LOG_PATH
export CONVERSATION_LOGGER_LOG_PATH SECOND_BRAIN_SERVICE_NAME CONVERSATION_LOGGER_SERVICE_NAME

# -----------------------------
# 2) Build app (npm install/build)
# -----------------------------
log "Running npm install..."
(
  cd "$REPO_DIR"
  npm install
)

log "Running npm run build..."
(
  cd "$REPO_DIR"
  npm run build
)

# ----------------------------------------------
# 3) Ensure conversations directory exists
# ----------------------------------------------
log "Ensuring conversations directory exists..."
mkdir -p "$OPENCLAW_CONVERSATIONS_DIR"

# ------------------------------------------------
# 4) Render concrete launchd plists from templates
# ------------------------------------------------
log "Rendering launchd plists from templates..."
mkdir -p "$LAUNCH_AGENTS_DIR"

TMP_RENDER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/second-brain-install.XXXXXX")"
trap 'rm -rf "$TMP_RENDER_DIR"' EXIT

RENDERED_SECOND_BRAIN_PLIST="$TMP_RENDER_DIR/${SECOND_BRAIN_SERVICE_NAME}.plist"
RENDERED_CONVERSATION_LOGGER_PLIST="$TMP_RENDER_DIR/${CONVERSATION_LOGGER_SERVICE_NAME}.plist"

render_plist "$SECOND_BRAIN_TEMPLATE" "$RENDERED_SECOND_BRAIN_PLIST"
render_plist "$CONVERSATION_LOGGER_TEMPLATE" "$RENDERED_CONVERSATION_LOGGER_PLIST"

# ----------------------------------------------------------------------
# 5) Unload old plists if present, copy new plists, bootstrap + kickstart
# ----------------------------------------------------------------------
log "Reloading launchd services..."

# Unload both new and legacy labels/plists (idempotent best-effort)
bootout_if_exists "$SECOND_BRAIN_SERVICE_NAME" "$SECOND_BRAIN_PLIST_DEST"
bootout_if_exists "$CONVERSATION_LOGGER_SERVICE_NAME" "$CONVERSATION_LOGGER_PLIST_DEST"
bootout_if_exists "$LEGACY_SECOND_BRAIN_SERVICE_NAME" "$LEGACY_SECOND_BRAIN_PLIST_DEST"
bootout_if_exists "$LEGACY_CONVERSATION_LOGGER_SERVICE_NAME" "$LEGACY_CONVERSATION_LOGGER_PLIST_DEST"

# Remove legacy files to avoid future conflicts on shared machines.
if [[ -f "$LEGACY_SECOND_BRAIN_PLIST_DEST" && "$LEGACY_SECOND_BRAIN_PLIST_DEST" != "$SECOND_BRAIN_PLIST_DEST" ]]; then
  rm -f "$LEGACY_SECOND_BRAIN_PLIST_DEST"
fi
if [[ -f "$LEGACY_CONVERSATION_LOGGER_PLIST_DEST" && "$LEGACY_CONVERSATION_LOGGER_PLIST_DEST" != "$CONVERSATION_LOGGER_PLIST_DEST" ]]; then
  rm -f "$LEGACY_CONVERSATION_LOGGER_PLIST_DEST"
fi

cp "$RENDERED_SECOND_BRAIN_PLIST" "$SECOND_BRAIN_PLIST_DEST"
cp "$RENDERED_CONVERSATION_LOGGER_PLIST" "$CONVERSATION_LOGGER_PLIST_DEST"

launchctl bootstrap "gui/$USER_UID" "$SECOND_BRAIN_PLIST_DEST"
launchctl bootstrap "gui/$USER_UID" "$CONVERSATION_LOGGER_PLIST_DEST"

launchctl kickstart -k "gui/$USER_UID/$SECOND_BRAIN_SERVICE_NAME"
launchctl kickstart -k "gui/$USER_UID/$CONVERSATION_LOGGER_SERVICE_NAME"

# ---------------------------------------------------
# 6) Optional tailscale serve setup (if available)
# ---------------------------------------------------
TAILSCALE_STATUS="not installed"
TAILSCALE_URL=""
if command_exists tailscale; then
  if tailscale serve --bg 3334 "http://127.0.0.1:${SECOND_BRAIN_PORT}" >/dev/null 2>&1; then
    TAILSCALE_STATUS="configured (3334 -> 127.0.0.1:${SECOND_BRAIN_PORT})"

    # Best-effort URL discovery.
    TAILSCALE_DNS_NAME="$(tailscale status --json 2>/dev/null | "$PYTHON3_PATH" -c 'import json,sys
try:
    data=json.load(sys.stdin)
    print((data.get("Self",{}).get("DNSName","") or "").rstrip("."))
except Exception:
    print("")' || true)"
    if [[ -n "$TAILSCALE_DNS_NAME" ]]; then
      TAILSCALE_URL="http://${TAILSCALE_DNS_NAME}:3334"
    fi
  else
    TAILSCALE_STATUS="installed, but tailscale serve failed"
    warn "tailscale serve could not be configured (is Tailscale running and logged in?)."
  fi
fi

# ---------------------------------------------------
# 7) Verify app + launchd services
# ---------------------------------------------------
APP_URL="http://127.0.0.1:${SECOND_BRAIN_PORT}"
APP_HEALTH="failed"
for attempt in $(seq 1 30); do
  if curl -fsS "$APP_URL" >/dev/null 2>&1; then
    APP_HEALTH="ok"
    break
  fi
  sleep 1
done

sleep 2

SECOND_BRAIN_LAUNCHCTL_LINE="$(launchctl list | grep -F "$SECOND_BRAIN_SERVICE_NAME" || true)"
LOGGER_LAUNCHCTL_LINE="$(launchctl list | grep -F "$CONVERSATION_LOGGER_SERVICE_NAME" || true)"

SECOND_BRAIN_LAUNCHCTL_STATUS="missing"
LOGGER_LAUNCHCTL_STATUS="missing"
if [[ -n "$SECOND_BRAIN_LAUNCHCTL_LINE" ]]; then
  SECOND_BRAIN_LAUNCHCTL_STATUS="loaded"
fi
if [[ -n "$LOGGER_LAUNCHCTL_LINE" ]]; then
  LOGGER_LAUNCHCTL_STATUS="loaded"
fi

# ---------------------------------
# 8) Print summary + access URLs
# ---------------------------------
printf "\n"
printf "============================================================\n"
printf "✅ Second Brain install complete\n"
printf "============================================================\n"
printf "Repo directory:                %s\n" "$REPO_DIR"
printf "HOME:                          %s\n" "$HOME_DIR"
printf "OPENCLAW_HOME:                 %s\n" "$OPENCLAW_HOME"
printf "OPENCLAW_WORKSPACE:            %s\n" "$OPENCLAW_WORKSPACE"
printf "OPENCLAW_CONVERSATIONS_DIR:    %s\n" "$OPENCLAW_CONVERSATIONS_DIR"
printf "OPENCLAW_SESSIONS_DIR:         %s\n" "$OPENCLAW_SESSIONS_DIR"
printf "npx path:                      %s\n" "$NPX_PATH"
printf "python3 path:                  %s\n" "$PYTHON3_PATH"
printf "\n"
printf "Second Brain service:          %s (%s)\n" "$SECOND_BRAIN_SERVICE_NAME" "$SECOND_BRAIN_LAUNCHCTL_STATUS"
printf "Conversation Logger service:   %s (%s)\n" "$CONVERSATION_LOGGER_SERVICE_NAME" "$LOGGER_LAUNCHCTL_STATUS"
printf "launchctl list (app):          %s\n" "${SECOND_BRAIN_LAUNCHCTL_LINE:-not listed}"
printf "launchctl list (logger):       %s\n" "${LOGGER_LAUNCHCTL_LINE:-not listed}"
printf "LaunchAgent plist (app):       %s\n" "$SECOND_BRAIN_PLIST_DEST"
printf "LaunchAgent plist (logger):    %s\n" "$CONVERSATION_LOGGER_PLIST_DEST"
printf "\n"
printf "App health check (curl):       %s (%s)\n" "$APP_HEALTH" "$APP_URL"
printf "Tailscale serve:               %s\n" "$TAILSCALE_STATUS"
printf "\n"
printf "Second Brain URL (local):      %s\n" "$APP_URL"
if [[ -n "$TAILSCALE_URL" ]]; then
  printf "Second Brain URL (Tailscale):  %s\n" "$TAILSCALE_URL"
else
  printf "Second Brain URL (Tailscale):  check: tailscale serve status\n"
fi
printf "============================================================\n"

if [[ "$APP_HEALTH" != "ok" ]]; then
  warn "App did not pass curl verification within 30s. Check logs: $SECOND_BRAIN_LOG_PATH"
fi

if [[ "$SECOND_BRAIN_LAUNCHCTL_STATUS" != "loaded" || "$LOGGER_LAUNCHCTL_STATUS" != "loaded" ]]; then
  warn "One or more launchd services are not listed. Run: launchctl list | grep -E 'second-brain|conversation-logger'"
fi
