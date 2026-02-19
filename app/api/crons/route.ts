import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';

const CRON_JOBS_PATH = '/Users/jackanglim/.openclaw/cron/jobs.json';

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  scheduleKind: 'cron' | 'at' | 'unknown';
  tz?: string;
  nextRunAtMs?: number | null;
  lastRunAtMs?: number | null;
  status: string;
  enabled: boolean;
  target?: string;
  agent?: string;
}

const FALLBACK_CRONS: CronJob[] = [
  { id: 'f1', name: 'Morning Calendar Summary',  schedule: '30 7 * * 1-5',   scheduleKind: 'cron', tz: 'America/New_York', status: 'ok', enabled: true, target: 'isolated' },
  { id: 'f2', name: 'Notion Project Priorities', schedule: '0 8 * * 1-5',    scheduleKind: 'cron', tz: 'America/New_York', status: 'ok', enabled: true, target: 'main' },
  { id: 'f3', name: 'Morning Project Update',    schedule: '30 8 * * 1-5',   scheduleKind: 'cron', tz: 'America/New_York', status: 'ok', enabled: true, target: 'main' },
  { id: 'f4', name: 'Mid-Morning Nudge',         schedule: '30 10 * * 1-5',  scheduleKind: 'cron', tz: 'America/New_York', status: 'ok', enabled: true, target: 'main' },
  { id: 'f5', name: 'Proactive: Midday Context Nudge', schedule: '0 12 * * *', scheduleKind: 'cron', tz: 'America/New_York', status: 'ok', enabled: true, target: 'isolated' },
  { id: 'f6', name: 'Afternoon Check-In',        schedule: '0 14 * * 1-5',   scheduleKind: 'cron', tz: 'America/New_York', status: 'ok', enabled: true, target: 'main' },
  { id: 'f7', name: 'End of Day Wrap-Up',        schedule: '0 17 * * 1-5',   scheduleKind: 'cron', tz: 'America/New_York', status: 'ok', enabled: true, target: 'main' },
  { id: 'f8', name: 'Proactive: Evening News Drop', schedule: '0 19 * * *',  scheduleKind: 'cron', tz: 'America/New_York', status: 'ok', enabled: true, target: 'isolated' },
  { id: 'f9', name: 'TARS Overnight Builder',    schedule: '0 4 * * *',       scheduleKind: 'cron', tz: 'America/New_York', status: 'ok', enabled: true, target: 'isolated' },
  { id: 'f10', name: 'Todoist Overdue Check',    schedule: '0 1 * * *',       scheduleKind: 'cron', tz: 'America/New_York', status: 'ok', enabled: true, target: 'isolated' },
];

interface RawJob {
  id: string;
  agentId?: string;
  name: string;
  enabled?: boolean;
  schedule: { kind: 'cron' | 'at'; expr?: string; tz?: string; at?: string };
  sessionTarget?: string;
  state?: { nextRunAtMs?: number; lastRunAtMs?: number; lastStatus?: string; consecutiveErrors?: number };
}

function mapJob(raw: RawJob): CronJob {
  const sched = raw.schedule;
  const state = raw.state ?? {};

  let schedStr: string;
  let kind: 'cron' | 'at' | 'unknown';

  if (sched.kind === 'cron') {
    schedStr = sched.expr ?? '';
    kind = 'cron';
  } else if (sched.kind === 'at') {
    schedStr = sched.at ?? '';
    kind = 'at';
  } else {
    schedStr = JSON.stringify(sched);
    kind = 'unknown';
  }

  const errors = state.consecutiveErrors ?? 0;
  let status = state.lastStatus ?? 'idle';
  if (errors > 0) status = 'error';

  return {
    id: raw.id,
    name: raw.name,
    schedule: schedStr,
    scheduleKind: kind,
    tz: sched.tz,
    nextRunAtMs: state.nextRunAtMs ?? null,
    lastRunAtMs: state.lastRunAtMs ?? null,
    status,
    enabled: raw.enabled ?? true,
    target: raw.sessionTarget,
    agent: raw.agentId,
  };
}

export async function GET() {
  try {
    const content = await readFile(CRON_JOBS_PATH, 'utf-8');
    const parsed = JSON.parse(content) as { version: number; jobs: RawJob[] };
    const jobs: CronJob[] = (parsed.jobs ?? []).map(mapJob);
    return NextResponse.json({ source: 'live', crons: jobs });
  } catch (err) {
    console.error('Failed to read cron jobs file:', err);
    return NextResponse.json({ source: 'fallback', crons: FALLBACK_CRONS });
  }
}
