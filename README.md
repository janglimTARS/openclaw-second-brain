# openclaw-second-brain

Second Brain web UI for OpenClaw: memory viewer, conversation browser, and markdown search.

## 1) Prerequisites

- Node.js 20+
- npm
- Python 3.10+ (for conversation logger)
- macOS + `launchctl` (only if you want auto-start)
- Optional: Tailscale (`tailscale serve`)

## 2) Clone and install

```bash
git clone git@github.com:janglimTARS/openclaw-second-brain.git
cd openclaw-second-brain
npm install
cp .env.example .env.local
```

## 3) Configure paths (required)

Set `OPENCLAW_WORKSPACE`. Default is `~/.openclaw/workspace`.

Minimal config:

```bash
export OPENCLAW_WORKSPACE="$HOME/.openclaw/workspace"
```

Optional overrides:

```bash
export OPENCLAW_HOME="$HOME/.openclaw"
export OPENCLAW_CONVERSATIONS_DIR="$OPENCLAW_WORKSPACE/conversations"
export OPENCLAW_SESSIONS_DIR="$OPENCLAW_HOME/agents/main/sessions"
```

## 4) Build and run

Development:

```bash
OPENCLAW_WORKSPACE="$HOME/.openclaw/workspace" \
  npm run dev -- -p 3333 -H 127.0.0.1
```

Production:

```bash
npm run build
OPENCLAW_WORKSPACE="$HOME/.openclaw/workspace" \
  npm run start -- -p 3333 -H 0.0.0.0
```

App URL: `http://127.0.0.1:3333`

## 5) Conversation logger daemon

Script is included at:

- `scripts/conversation-logger-daemon.py`

Run once for validation:

```bash
OPENCLAW_WORKSPACE="$HOME/.openclaw/workspace" \
  python3 scripts/conversation-logger-daemon.py --once
```

Run continuously:

```bash
OPENCLAW_WORKSPACE="$HOME/.openclaw/workspace" \
  python3 scripts/conversation-logger-daemon.py
```

Logger output goes to `OPENCLAW_CONVERSATIONS_DIR` (default: `$OPENCLAW_WORKSPACE/conversations`).

## 6) launchd auto-start (macOS)

Templates:

- `launchd/com.tars.second-brain.plist.template`
- `launchd/com.tars.conversation-logger.plist.template`

### 6a. Create concrete plists

Copy templates into `~/Library/LaunchAgents/` and replace all `__PLACEHOLDER__` tokens:

Required placeholders to replace:

- `__SECOND_BRAIN_REPO_PATH__`
- `__OPENCLAW_HOME__`
- `__OPENCLAW_WORKSPACE__`
- `__OPENCLAW_CONVERSATIONS_DIR__`
- `__OPENCLAW_SESSIONS_DIR__`
- `__NPX_PATH__`
- `__PYTHON3_PATH__`
- `__SECOND_BRAIN_PORT__` (recommended `3333`)
- `__SECOND_BRAIN_HOST__` (recommended `0.0.0.0`)
- `__SECOND_BRAIN_LOG_PATH__`
- `__CONVERSATION_LOGGER_LOG_PATH__`

### 6b. Load / reload services

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.tars.second-brain.plist 2>/dev/null || true
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.tars.conversation-logger.plist 2>/dev/null || true

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tars.second-brain.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tars.conversation-logger.plist

launchctl kickstart -k gui/$(id -u)/com.tars.second-brain
launchctl kickstart -k gui/$(id -u)/com.tars.conversation-logger
```

## 7) Optional: expose with Tailscale Serve

```bash
tailscale serve --bg 3334 http://127.0.0.1:3333
tailscale serve status
```

## 8) Notes for agents

- Paths are environment-driven; no hardcoded user directory is required.
- Runtime artifacts and local data are gitignored (`node_modules`, `.next`, `dist`, `.state.json`, logs, etc.).
- Do not commit local memory, conversations, session transcripts, tokens, or secrets.
