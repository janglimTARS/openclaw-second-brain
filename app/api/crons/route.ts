import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import os from 'os';
import path from 'path';

export const dynamic = 'force-dynamic';

const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const CRON_JOBS_PATH = path.join(HERMES_HOME, 'cron', 'jobs.json');

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

interface HermesRawJob {
  id: string;
  name: string;
  enabled?: boolean;
  schedule: { kind: 'cron' | 'at'; expr?: string; display?: string; tz?: string; at?: string };
  deliver?: string | null;
  state?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
}

function parseTimestampMs(value?: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function mapHermesJob(raw: HermesRawJob): CronJob {
  const sched = raw.schedule;
  const status = raw.last_status ?? raw.state ?? 'idle';

  return {
    id: raw.id,
    name: raw.name,
    schedule: sched.kind === 'at' ? (sched.at ?? sched.display ?? '') : (sched.expr ?? sched.display ?? ''),
    scheduleKind: sched.kind ?? 'unknown',
    tz: sched.tz,
    nextRunAtMs: parseTimestampMs(raw.next_run_at),
    lastRunAtMs: parseTimestampMs(raw.last_run_at),
    status,
    enabled: raw.enabled ?? true,
    target: raw.deliver ?? undefined,
  };
}

export async function GET() {
  try {
    const content = await readFile(CRON_JOBS_PATH, 'utf-8');
    const parsed = JSON.parse(content) as { jobs?: HermesRawJob[] };
    const jobs: CronJob[] = (parsed.jobs ?? []).map(mapHermesJob);
    return NextResponse.json({ source: 'live', crons: jobs });
  } catch (err) {
    console.error('Failed to read cron jobs file:', err);
    return NextResponse.json(
      { source: 'unavailable', crons: [], error: `Unable to read Hermes cron jobs at ${CRON_JOBS_PATH}` },
      { status: 500 }
    );
  }
}
