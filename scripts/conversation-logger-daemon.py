#!/usr/bin/env python3
"""
Conversation Logger Daemon
Watches OpenClaw session transcript files and writes clean markdown conversation logs.

Environment variables (all optional):
- OPENCLAW_HOME (default: ~/.openclaw)
- OPENCLAW_WORKSPACE (default: <OPENCLAW_HOME>/workspace)
- OPENCLAW_SESSIONS_DIR (default: <OPENCLAW_HOME>/agents/main/sessions)
- OPENCLAW_CONVERSATIONS_DIR (default: <OPENCLAW_WORKSPACE>/conversations)
- OPENCLAW_CONVERSATION_STATE_FILE (default: <OPENCLAW_CONVERSATIONS_DIR>/.state.json)
- OPENCLAW_MAIN_SESSION_ID (fallback session UUID, optional)
- OPENCLAW_TIMEZONE (default: system local timezone)
- OPENCLAW_LOGGER_POLL_SECONDS (default: 1)
- OPENCLAW_LOGGER_MAX_MESSAGE_LENGTH (default: 2000)
"""

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from typing import Optional


def resolve_path(value: str) -> Path:
    return Path(os.path.expanduser(value)).resolve()


def load_timezone() -> timezone | ZoneInfo:
    tz_name = os.getenv("OPENCLAW_TIMEZONE", "").strip()

    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except Exception as exc:  # pragma: no cover - defensive
            print(
                f"[daemon] Warning: Invalid OPENCLAW_TIMEZONE={tz_name!r}: {exc}. Falling back to system timezone.",
                file=sys.stderr,
            )

    system_tz = datetime.now().astimezone().tzinfo
    return system_tz if system_tz is not None else timezone.utc


# Configuration
OPENCLAW_HOME = resolve_path(os.getenv("OPENCLAW_HOME", "~/.openclaw"))
WORKSPACE_DIR = resolve_path(os.getenv("OPENCLAW_WORKSPACE", str(OPENCLAW_HOME / "workspace")))
SESSIONS_DIR = resolve_path(
    os.getenv("OPENCLAW_SESSIONS_DIR", str(OPENCLAW_HOME / "agents" / "main" / "sessions"))
)
CONVERSATIONS_DIR = resolve_path(
    os.getenv("OPENCLAW_CONVERSATIONS_DIR", str(WORKSPACE_DIR / "conversations"))
)
STATE_FILE = resolve_path(
    os.getenv("OPENCLAW_CONVERSATION_STATE_FILE", str(CONVERSATIONS_DIR / ".state.json"))
)
MAIN_SESSION_ID = os.getenv("OPENCLAW_MAIN_SESSION_ID", "").strip()
LOCAL_TZ = load_timezone()
MAX_MESSAGE_LENGTH = int(os.getenv("OPENCLAW_LOGGER_MAX_MESSAGE_LENGTH", "2000"))
POLL_INTERVAL_SECONDS = float(os.getenv("OPENCLAW_LOGGER_POLL_SECONDS", "1"))

# Patterns to skip
SKIP_PATTERNS = [
    "HEARTBEAT",
    "Read HEARTBEAT.md",
    "GatewayRestart",
    "Exec failed",
    "Pre-compaction memory flush",
    "NO_REPLY",
    "HEARTBEAT_OK",
]


def load_state() -> dict:
    """Load the processing state from disk."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"[daemon] Warning: Could not load state: {e}", file=sys.stderr)
    return {"files": {}}


def save_state(state: dict) -> None:
    """Save the processing state to disk."""
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except IOError as e:
        print(f"[daemon] Warning: Could not save state: {e}", file=sys.stderr)


def should_skip_message(role: str, content: str) -> bool:
    """Check if a message should be skipped."""
    # Skip non-user/assistant roles
    if role not in ("user", "assistant"):
        return True

    # Skip empty content
    if not content or not content.strip():
        return True

    # Skip messages matching skip patterns
    for pattern in SKIP_PATTERNS:
        if pattern in content:
            return True

    return False


def truncate_message(content: str, max_length: int = MAX_MESSAGE_LENGTH) -> str:
    """Truncate long messages with a note."""
    if len(content) <= max_length:
        return content
    return content[:max_length].rstrip() + "\n\n[truncated]"


def parse_timestamp(ts_str: str) -> Optional[datetime]:
    """Parse ISO timestamp string to datetime."""
    try:
        # Handle ISO format with Z or +00:00
        normalized = ts_str.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        return parsed.astimezone(LOCAL_TZ)
    except (ValueError, TypeError):
        return None


def extract_text_content(content: list) -> str:
    """Extract text from content array."""
    texts = []
    for item in content:
        if isinstance(item, dict):
            if item.get("type") == "text" and "text" in item:
                texts.append(item["text"])
            elif item.get("type") == "thinking":
                # Skip thinking blocks
                continue
    return "".join(texts)


def process_message_line(line: str) -> Optional[dict]:
    """Process a single JSONL line and return log entry if applicable."""
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        return None

    # Only process message types
    if data.get("type") != "message":
        return None

    message = data.get("message", {})
    role = message.get("role")
    content = message.get("content")
    timestamp_str = data.get("timestamp") or message.get("timestamp")

    # Handle content array format
    if isinstance(content, list):
        content = extract_text_content(content)
    elif not isinstance(content, str):
        content = str(content) if content else ""

    # Skip unwanted messages
    if should_skip_message(role, content):
        return None

    # Parse timestamp
    parsed_ts = parse_timestamp(timestamp_str) if timestamp_str else None
    if not parsed_ts:
        parsed_ts = datetime.now(LOCAL_TZ)

    # Truncate long messages
    content = truncate_message(content)

    # Map role to display name
    role_label = "User" if role == "user" else "TARS"

    return {
        "timestamp": parsed_ts,
        "role": role_label,
        "content": content,
    }


def write_log_entry(entry: dict) -> None:
    """Write a log entry to the appropriate daily file."""
    ts = entry["timestamp"]
    role = entry["role"]
    content = entry["content"]

    CONVERSATIONS_DIR.mkdir(parents=True, exist_ok=True)

    target = CONVERSATIONS_DIR / f"{ts:%Y-%m-%d}.md"
    log_line = f"## {ts:%H:%M} - [{role}]\n{content}\n\n"

    # Check if we need a leading newline
    needs_leading_newline = False
    if target.exists() and target.stat().st_size > 0:
        with open(target, "rb") as f:
            f.seek(-1, 2)
            needs_leading_newline = f.read(1) != b"\n"

    with open(target, "a", encoding="utf-8") as f:
        if needs_leading_newline:
            f.write("\n")
        f.write(log_line)

    print(f"[daemon] Logged to {target.name}: {role} at {ts:%H:%M}")


def get_file_id(filepath: Path) -> str:
    """Get a stable ID for the session file based on its name (UUID)."""
    return filepath.stem  # Returns filename without extension


def process_file(filepath: Path, state: dict) -> int:
    """Process new lines from a file. Returns number of entries written."""
    file_id = get_file_id(filepath)
    file_state = state["files"].get(file_id, {"offset": 0})
    last_offset = file_state.get("offset", 0)

    if not filepath.exists():
        return 0

    current_size = filepath.stat().st_size

    # If file shrank, reset offset
    if current_size < last_offset:
        last_offset = 0

    if current_size == last_offset:
        return 0

    entries_written = 0

    with open(filepath, "r", encoding="utf-8") as f:
        # Seek to last processed position
        f.seek(last_offset)

        for line in f:
            line = line.strip()
            if not line:
                continue

            entry = process_message_line(line)
            if entry:
                write_log_entry(entry)
                entries_written += 1

        # Update offset
        new_offset = f.tell()

    # Update state using file_id (UUID) as key
    state["files"][file_id] = {
        "offset": new_offset,
        "last_processed": datetime.now(LOCAL_TZ).isoformat(),
    }

    return entries_written


def get_main_session_file() -> Optional[Path]:
    """Get the path to the main session file by reading sessions.json dynamically."""
    sessions_json = SESSIONS_DIR / "sessions.json"
    if sessions_json.exists():
        try:
            with open(sessions_json, "r", encoding="utf-8") as f:
                data = json.load(f)
            # Look for agent:main:main key
            main_entry = data.get("agent:main:main", {})
            session_id = main_entry.get("sessionId")
            if session_id:
                main_file = SESSIONS_DIR / f"{session_id}.jsonl"
                if main_file.exists():
                    return main_file
        except (json.JSONDecodeError, IOError):
            pass

    # Fallback: use explicit session ID if provided
    if MAIN_SESSION_ID:
        main_file = SESSIONS_DIR / f"{MAIN_SESSION_ID}.jsonl"
        if main_file.exists():
            return main_file

    # Last fallback: most recently modified jsonl file
    jsonl_files = [p for p in SESSIONS_DIR.glob("*.jsonl") if ".deleted." not in p.name]
    if not jsonl_files:
        return None

    return max(jsonl_files, key=lambda p: p.stat().st_mtime)


def run_daemon():
    """Main daemon loop."""
    print("[daemon] Starting conversation logger daemon")
    print(f"[daemon] Sessions dir: {SESSIONS_DIR}")
    print(f"[daemon] Conversations dir: {CONVERSATIONS_DIR}")
    print(f"[daemon] State file: {STATE_FILE}")
    print(f"[daemon] Poll interval: {POLL_INTERVAL_SECONDS}s")

    # Ensure directories exist
    CONVERSATIONS_DIR.mkdir(parents=True, exist_ok=True)

    # Load state
    state = load_state()
    print(f"[daemon] Loaded state with {len(state.get('files', {}))} tracked files")

    # Get main session file
    main_file = get_main_session_file()
    if not main_file:
        print("[daemon] ERROR: No session files found!", file=sys.stderr)
        sys.exit(1)

    print(f"[daemon] Watching main session: {main_file.name}")

    # Process existing content on startup (but only new lines based on state)
    entries = process_file(main_file, state)
    if entries > 0:
        print(f"[daemon] Wrote {entries} entries from existing file")
    save_state(state)

    # Watch for changes
    last_size = main_file.stat().st_size
    last_file_id = get_file_id(main_file)

    print("[daemon] Entering watch loop...")
    while True:
        try:
            time.sleep(POLL_INTERVAL_SECONDS)

            # Check if main session file changed (new session)
            current_main = get_main_session_file()
            if not current_main:
                continue

            current_file_id = get_file_id(current_main)

            # If session changed, update to new file
            if current_file_id != last_file_id:
                print(f"[daemon] Session changed: {current_main.name}")
                main_file = current_main
                last_file_id = current_file_id
                last_size = 0
                continue

            if not main_file.exists():
                continue

            current_size = main_file.stat().st_size

            if current_size > last_size:
                entries = process_file(main_file, state)
                if entries > 0:
                    save_state(state)
                last_size = current_size
            elif current_size < last_size:
                # File was truncated or rotated
                print("[daemon] File size decreased, resetting offset")
                state["files"][get_file_id(main_file)] = {"offset": 0}
                last_size = 0

        except KeyboardInterrupt:
            print("\n[daemon] Interrupted, saving state...")
            save_state(state)
            break
        except Exception as e:
            print(f"[daemon] Error: {e}", file=sys.stderr)
            time.sleep(5)  # Wait longer on error


def run_once():
    """Process files once and exit (for testing/debugging)."""
    print("[daemon] Running one-time processing...")

    state = load_state()
    main_file = get_main_session_file()

    if main_file:
        entries = process_file(main_file, state)
        print(f"[daemon] Wrote {entries} entries")
        save_state(state)
    else:
        print("[daemon] No session file found")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        run_once()
    else:
        run_daemon()
