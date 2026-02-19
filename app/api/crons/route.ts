import { NextResponse } from 'next/server';

const GATEWAY_URL = 'http://localhost:18789';
const GATEWAY_TOKEN = '12ddd7fd23429f590c692dc85184bda7d9321dc0a52ac90a';

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  next?: string | null;
  last?: string | null;
  status: string;
  target?: string;
  agent?: string;
}

const FALLBACK_CRONS: CronJob[] = [
  {
    id: 'fallback-1',
    name: 'Morning Calendar Summary',
    schedule: 'cron 30 7 * * 1-5 @ America/New_York',
    status: 'ok',
    target: 'isolated',
    agent: 'main',
  },
  {
    id: 'fallback-2',
    name: 'Notion Project Priorities',
    schedule: 'cron 0 8 * * 1-5 @ America/New_York',
    status: 'ok',
    target: 'main',
    agent: 'main',
  },
  {
    id: 'fallback-3',
    name: 'Morning Project Update',
    schedule: 'cron 30 8 * * 1-5 @ America/New_York',
    status: 'ok',
    target: 'main',
    agent: 'main',
  },
  {
    id: 'fallback-4',
    name: 'Mid-Morning Nudge',
    schedule: 'cron 30 10 * * 1-5 @ America/New_York',
    status: 'ok',
    target: 'main',
    agent: 'main',
  },
  {
    id: 'fallback-5',
    name: 'Proactive: Midday Context Nudge',
    schedule: 'cron 0 12 * * * @ America/New_York',
    status: 'ok',
    target: 'isolated',
    agent: 'main',
  },
  {
    id: 'fallback-6',
    name: 'Afternoon Check-In',
    schedule: 'cron 0 14 * * 1-5 @ America/New_York',
    status: 'ok',
    target: 'main',
    agent: 'main',
  },
  {
    id: 'fallback-7',
    name: 'End of Day Wrap-Up',
    schedule: 'cron 0 17 * * 1-5 @ America/New_York',
    status: 'ok',
    target: 'main',
    agent: 'main',
  },
  {
    id: 'fallback-8',
    name: 'Proactive: Evening News Drop',
    schedule: 'cron 0 19 * * * @ America/New_York',
    status: 'ok',
    target: 'isolated',
    agent: 'main',
  },
  {
    id: 'fallback-9',
    name: 'TARS Overnight Builder',
    schedule: 'cron 0 4 * * * @ America/New_York',
    status: 'ok',
    target: 'isolated',
    agent: 'main',
  },
  {
    id: 'fallback-10',
    name: 'Todoist Overdue Check',
    schedule: 'cron 0 1 * * * @ America/New_York',
    status: 'ok',
    target: 'isolated',
    agent: 'main',
  },
];

export async function GET() {
  try {
    const response = await fetch(`${GATEWAY_URL}/api/crons`, {
      headers: {
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Gateway returned ${response.status}`);
    }

    const data = await response.json();
    // Gateway may return array directly or wrapped
    const crons: CronJob[] = Array.isArray(data) ? data : data.crons ?? data.data ?? [];

    return NextResponse.json({ source: 'live', crons });
  } catch (err) {
    console.error('Failed to fetch crons from gateway:', err);
    return NextResponse.json({ source: 'fallback', crons: FALLBACK_CRONS });
  }
}
