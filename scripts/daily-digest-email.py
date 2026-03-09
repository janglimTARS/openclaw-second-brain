#!/usr/bin/env python3
"""
Build and optionally send a daily digest email from Second Brain data.

Includes:
- Recent memory highlights
- Conversation highlights
- New learnings (heuristic)
- Upcoming calendar events (best-effort via `gog` CLI)

Usage:
  python3 scripts/daily-digest-email.py --dry-run
  python3 scripts/daily-digest-email.py --send
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import subprocess
import textwrap
from pathlib import Path
from typing import Iterable, List

WORKSPACE = Path(os.getenv("OPENCLAW_WORKSPACE", str(Path.home() / ".openclaw/workspace")))
MEMORY_DIR = WORKSPACE / "memory"
CONVERSATIONS_DIR = Path(os.getenv("OPENCLAW_CONVERSATIONS_DIR", str(WORKSPACE / "conversations")))
SEND_EMAIL_SCRIPT = WORKSPACE / "skills/agentmail/scripts/send_email.py"

DEFAULT_INBOX = os.getenv("DIGEST_INBOX", "TARSassistant@agentmail.to")
DEFAULT_TO = os.getenv("DIGEST_TO", "jackanglim3@gmail.com")
DEFAULT_ACCOUNT = os.getenv("DIGEST_GCAL_ACCOUNT", "jackanglim3@gmail.com")


def sh(cmd: list[str]) -> tuple[int, str, str]:
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def read_tail(path: Path, max_lines: int = 200) -> list[str]:
    if not path.exists():
        return []
    lines = path.read_text(errors="ignore").splitlines()
    return lines[-max_lines:]


def clean_line(line: str) -> str:
    line = line.strip()
    line = re.sub(r"^[-*\d.\)\s]+", "", line)
    return line.strip()


def pick_bullets(lines: Iterable[str], limit: int = 8) -> list[str]:
    out: list[str] = []
    seen = set()
    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        if s.startswith("#"):
            continue
        if s.startswith("```"):
            continue
        if len(s) < 25:
            continue
        if "BEGIN" in s or "END" in s:
            continue
        c = clean_line(s)
        if not c:
            continue
        key = c.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def extract_new_learnings(lines: Iterable[str], limit: int = 4) -> list[str]:
    markers = ("learn", "realized", "lesson", "figured out", "found that", "insight")
    picks = []
    for l in lines:
        ll = l.lower()
        if any(m in ll for m in markers):
            c = clean_line(l)
            if len(c) >= 20:
                picks.append(c)
    if not picks:
        return []
    dedup = []
    seen = set()
    for p in picks:
        k = p.lower()
        if k not in seen:
            dedup.append(p)
            seen.add(k)
        if len(dedup) >= limit:
            break
    return dedup


def get_calendar_events(now: dt.datetime) -> list[str]:
    end = now + dt.timedelta(days=1)
    iso_start = now.strftime("%Y-%m-%dT%H:%M:%S")
    iso_end = end.strftime("%Y-%m-%dT%H:%M:%S")

    candidates = [
        ["gog", "calendar", "events", "list", "--account", DEFAULT_ACCOUNT, "--from", iso_start, "--to", iso_end],
        ["gog", "calendar", "list", "--account", DEFAULT_ACCOUNT, "--from", iso_start, "--to", iso_end],
    ]

    text = ""
    for cmd in candidates:
        rc, out, _ = sh(cmd)
        if rc == 0 and out:
            text = out
            break

    if not text:
        return []

    lines = [l.strip() for l in text.splitlines() if l.strip()]
    events = []
    for l in lines:
        if l.startswith("{") or l.startswith("["):
            continue
        if "SUMMARY" in l.upper() or "EVENT" in l.upper() or re.search(r"\d{1,2}:\d{2}", l):
            events.append(l)
        elif re.search(r"\b(AM|PM|am|pm)\b", l):
            events.append(l)
    if not events:
        events = lines[:5]
    return events[:6]


def build_digest(now: dt.datetime) -> tuple[str, str]:
    today = now.date()
    yday = today - dt.timedelta(days=1)

    memory_files = [MEMORY_DIR / f"{today}.md", MEMORY_DIR / f"{yday}.md"]
    convo_files = [CONVERSATIONS_DIR / f"{today}.md", CONVERSATIONS_DIR / f"{yday}.md"]

    memory_lines = []
    for f in memory_files:
        memory_lines.extend(read_tail(f, 220))

    convo_lines = []
    for f in convo_files:
        convo_lines.extend(read_tail(f, 260))

    memory_highlights = pick_bullets(memory_lines, limit=6)
    convo_highlights = pick_bullets(convo_lines, limit=6)
    learnings = extract_new_learnings(memory_lines + convo_lines, limit=4)
    events = get_calendar_events(now)

    if not memory_highlights:
        memory_highlights = ["No major memory updates captured in the last 24h."]
    if not convo_highlights:
        convo_highlights = ["No major conversation highlights captured in the last 24h."]
    if not learnings:
        learnings = ["No explicit learnings detected; pipeline still warming up."]
    if not events:
        events = ["No upcoming calendar events detected (or calendar CLI unavailable)."]

    subject = f"Second Brain Daily Digest — {today.isoformat()}"

    body = textwrap.dedent(
        f"""
        Morning Jack,

        Here’s your automated Second Brain digest for {today.isoformat()}.

        Highlights from Memory
        {chr(10).join(f"- {x}" for x in memory_highlights)}

        Highlights from Conversations
        {chr(10).join(f"- {x}" for x in convo_highlights)}

        New Learnings
        {chr(10).join(f"- {x}" for x in learnings)}

        Upcoming (next 24h)
        {chr(10).join(f"- {x}" for x in events)}

        — TARS
        """
    ).strip()

    return subject, body


def send_email(subject: str, body: str, inbox: str, to: str) -> tuple[int, str, str]:
    cmd = [
        "python3",
        str(SEND_EMAIL_SCRIPT),
        "--inbox",
        inbox,
        "--to",
        to,
        "--subject",
        subject,
        "--text",
        body,
    ]
    return sh(cmd)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--send", action="store_true", help="Send email via AgentMail")
    parser.add_argument("--dry-run", action="store_true", help="Print digest only")
    parser.add_argument("--inbox", default=DEFAULT_INBOX)
    parser.add_argument("--to", default=DEFAULT_TO)
    args = parser.parse_args()

    now = dt.datetime.now()
    subject, body = build_digest(now)

    print(subject)
    print("=" * len(subject))
    print(body)

    if args.send:
        rc, out, err = send_email(subject, body, args.inbox, args.to)
        if rc != 0:
            print("\n[send failed]")
            print(err or out)
            return rc
        print("\n[send ok]")
        print(out)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
