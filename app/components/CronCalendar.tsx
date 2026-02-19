'use client';

import { useEffect, useState } from 'react';

interface CronJob {
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

interface ParsedCron {
  job: CronJob;
  type: 'hourly' | 'daily' | 'weekday' | 'weekend' | 'oneshot' | 'other';
  hour: number | null;
  minute: number | null;
  days: number[];         // 0=Sun,1=Mon,...,6=Sat
  humanSchedule: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

function parseCron(job: CronJob): ParsedCron {
  // One-shot "at" schedules
  if (job.scheduleKind === 'at') {
    const dateStr = job.schedule;
    let human = `One-shot`;
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        human = `One-shot: ${d.toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
        })}`;
      }
    } catch {}
    return {
      job, type: 'oneshot', hour: null, minute: null, days: [], humanSchedule: human,
      color: 'text-gray-400', bgColor: 'bg-gray-800/40', borderColor: 'border-gray-600',
    };
  }

  // Parse cron expression "M H dom M dow"
  // schedule is like "30 7 * * 1-5" or "0 * * * *"
  const parts = job.schedule.trim().split(/\s+/);
  if (parts.length < 5) {
    return {
      job, type: 'other', hour: null, minute: null, days: [], humanSchedule: job.schedule,
      color: 'text-terminal-dim', bgColor: 'bg-gray-800/40', borderColor: 'border-gray-600',
    };
  }

  const [minPart, hourPart, , , dowPart] = parts;

  const isHourly = hourPart === '*';
  const hour = isHourly ? null : parseInt(hourPart, 10);
  const minute = minPart === '*' ? 0 : parseInt(minPart, 10);

  let days: number[] = [];
  if (dowPart !== '*') {
    if (dowPart.includes('-')) {
      const [start, end] = dowPart.split('-').map(Number);
      for (let i = start; i <= end; i++) days.push(i);
    } else {
      days = dowPart.split(',').map(Number);
    }
  }

  let type: ParsedCron['type'];
  let humanSchedule: string;

  if (isHourly) {
    type = 'hourly';
    humanSchedule = 'Every hour';
    if (minPart !== '0' && minPart !== '*') {
      humanSchedule = `Every hour at :${String(minute).padStart(2, '0')}`;
    }
  } else if (days.length === 0) {
    type = 'daily';
    humanSchedule = `Daily ${formatTime(hour!, minute)}`;
  } else {
    const isWeekday = days.length === 5 && days.every(d => d >= 1 && d <= 5);
    const isWeekend = days.length === 2 && days.every(d => d === 0 || d === 6);
    if (isWeekday) {
      type = 'weekday';
      humanSchedule = `Weekdays ${formatTime(hour!, minute)}`;
    } else if (isWeekend) {
      type = 'weekend';
      humanSchedule = `Weekends ${formatTime(hour!, minute)}`;
    } else {
      type = 'other';
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      humanSchedule = `${days.map(d => dayNames[d]).join('/')} ${formatTime(hour!, minute)}`;
    }
  }

  const colorMap: Record<string, { color: string; bgColor: string; borderColor: string }> = {
    hourly:  { color: 'text-yellow-300',  bgColor: 'bg-amber-900/40',  borderColor: 'border-amber-500'  },
    daily:   { color: 'text-blue-300',    bgColor: 'bg-blue-900/40',   borderColor: 'border-blue-500'   },
    weekday: { color: 'text-green-300',   bgColor: 'bg-green-900/40',  borderColor: 'border-green-600'  },
    weekend: { color: 'text-purple-300',  bgColor: 'bg-purple-900/40', borderColor: 'border-purple-500' },
    oneshot: { color: 'text-gray-400',    bgColor: 'bg-gray-800/40',   borderColor: 'border-gray-600'   },
    other:   { color: 'text-terminal-text', bgColor: 'bg-gray-800/40', borderColor: 'border-gray-600'   },
  };

  return { job, type, hour, minute, days, humanSchedule, ...colorMap[type] };
}

function formatTime(hour: number, minute: number | null): string {
  const m = minute ?? 0;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatRelativeMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const now = Date.now();
  const diff = now - ms;
  const abs = Math.abs(diff);
  const future = diff < 0;
  if (abs < 60000) return future ? 'in <1m' : 'just now';
  if (abs < 3600000) return future ? `in ${Math.round(abs / 60000)}m` : `${Math.round(abs / 60000)}m ago`;
  if (abs < 86400000) return future ? `in ${Math.round(abs / 3600000)}h` : `${Math.round(abs / 3600000)}h ago`;
  return future ? `in ${Math.round(abs / 86400000)}d` : `${Math.round(abs / 86400000)}d ago`;
}

function firesOnDay(parsed: ParsedCron, dayOfWeek: number): boolean {
  if (parsed.type === 'oneshot') return false;
  if (parsed.type === 'hourly') return true;
  if (parsed.days.length === 0) return true;
  return parsed.days.includes(dayOfWeek);
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_OF_WEEK = [1, 2, 3, 4, 5, 6, 0]; // Mon=1 ... Sun=0

// Representative hours for the weekly grid
const GRID_HOURS = [1, 4, 7, 8, 9, 10, 12, 14, 17, 19, 22];

export default function CronCalendar() {
  const [parsedCrons, setParsedCrons] = useState<ParsedCron[]>([]);
  const [source, setSource] = useState<'live' | 'fallback' | 'loading'>('loading');
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [selectedCron, setSelectedCron] = useState<ParsedCron | null>(null);

  useEffect(() => {
    fetch('/api/crons', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        const crons: CronJob[] = data.crons ?? [];
        setParsedCrons(crons.map(parseCron));
        setSource(data.source);
      })
      .catch(() => setSource('fallback'));
  }, []);

  const sortedCrons = [...parsedCrons].sort((a, b) => {
    const aH = a.hour ?? -1, bH = b.hour ?? -1;
    if (aH !== bH) return aH - bH;
    return (a.minute ?? 0) - (b.minute ?? 0);
  });

  const typeLabel: Record<string, string> = {
    hourly: '⚡ Hourly', daily: '🌀 Daily', weekday: '📅 Weekday',
    weekend: '🌅 Weekend', oneshot: '🎯 One-shot', other: '⚙️ Custom',
  };

  const statusDot = (s: string) =>
    s === 'ok' ? '🟢' : s === 'idle' ? '⚪' : '🔴';

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto p-8">

        {/* Header */}
        <div className="mb-6 pb-4 border-b border-terminal-border flex items-start justify-between">
          <div>
            <div className="text-xs text-terminal-dim mb-1 uppercase tracking-widest">Automation</div>
            <h1 className="text-3xl font-bold text-terminal-green font-mono">🕐 Cron Calendar</h1>
            <p className="text-sm text-terminal-dim mt-1">
              {source === 'loading' && 'Fetching cron jobs…'}
              {source === 'live' && `${parsedCrons.length} jobs · live`}
              {source === 'fallback' && `${parsedCrons.length} jobs · fallback`}
            </p>
          </div>
          <div className="flex gap-2 mt-1">
            {(['calendar', 'list'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded text-sm font-mono border transition-colors ${
                  view === v
                    ? 'bg-terminal-green text-terminal-bg border-terminal-green'
                    : 'border-terminal-border text-terminal-dim hover:text-terminal-green hover:border-terminal-green'
                }`}
              >
                {v === 'calendar' ? '📅 Grid' : '📋 List'}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mb-6 text-xs">
          {[
            { dot: 'bg-amber-500',  label: 'Hourly'   },
            { dot: 'bg-blue-500',   label: 'Daily'    },
            { dot: 'bg-green-500',  label: 'Weekday'  },
            { dot: 'bg-purple-500', label: 'Weekend'  },
            { dot: 'bg-gray-500',   label: 'One-shot' },
          ].map(({ dot, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-terminal-dim">
              <div className={`w-2.5 h-2.5 rounded-full ${dot}`} />
              {label}
            </div>
          ))}
        </div>

        {source === 'loading' ? (
          <div className="flex items-center justify-center h-40">
            <div className="text-terminal-green animate-pulse font-mono">Loading cron jobs…</div>
          </div>
        ) : view === 'calendar' ? (
          <WeeklyGrid parsedCrons={sortedCrons} onSelect={c => setSelectedCron(prev => prev?.job.id === c.job.id ? null : c)} selected={selectedCron} />
        ) : (
          <ListView parsedCrons={sortedCrons} typeLabel={typeLabel} statusDot={statusDot}
            onSelect={c => setSelectedCron(prev => prev?.job.id === c.job.id ? null : c)} selected={selectedCron} />
        )}

        {selectedCron && (
          <DetailPanel parsed={selectedCron} typeLabel={typeLabel} statusDot={statusDot} onClose={() => setSelectedCron(null)} />
        )}
      </div>
    </div>
  );
}

// ─── Weekly Grid ─────────────────────────────────────────────────────────────

function WeeklyGrid({ parsedCrons, onSelect, selected }: {
  parsedCrons: ParsedCron[];
  onSelect: (p: ParsedCron) => void;
  selected: ParsedCron | null;
}) {
  const dotColor: Record<string, string> = {
    hourly: 'bg-amber-500', daily: 'bg-blue-500', weekday: 'bg-green-500',
    weekend: 'bg-purple-500', oneshot: 'bg-gray-500', other: 'bg-gray-400',
  };

  const hourlyCrons  = parsedCrons.filter(p => p.type === 'hourly');
  const oneshotCrons = parsedCrons.filter(p => p.type === 'oneshot');
  const timedCrons   = parsedCrons.filter(p => p.type !== 'hourly' && p.type !== 'oneshot' && p.hour !== null);

  // Build grid: hour → dayIndex → ParsedCron[]
  const gridMap: Record<number, Record<number, ParsedCron[]>> = {};
  for (const h of GRID_HOURS) {
    gridMap[h] = {};
    for (let d = 0; d < 7; d++) gridMap[h][d] = [];
  }

  for (const p of timedCrons) {
    if (p.hour == null) continue;
    const nearest = GRID_HOURS.reduce((prev, curr) =>
      Math.abs(curr - p.hour!) < Math.abs(prev - p.hour!) ? curr : prev,
    );
    for (let d = 0; d < 7; d++) {
      if (firesOnDay(p, DAY_OF_WEEK[d])) gridMap[nearest][d].push(p);
    }
  }

  const today = new Date().getDay(); // 0=Sun

  return (
    <div className="space-y-3">
      {/* Hourly bar */}
      {hourlyCrons.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-3">
          <div className="text-xs text-amber-400 font-mono font-bold mb-2 uppercase tracking-widest">⚡ Hourly — fires every hour, every day</div>
          <div className="flex flex-wrap gap-2">
            {hourlyCrons.map(p => (
              <button key={p.job.id} onClick={() => onSelect(p)}
                className={`px-2 py-1 rounded text-xs font-mono border transition-all ${
                  selected?.job.id === p.job.id
                    ? 'bg-amber-500 text-terminal-bg border-amber-400'
                    : 'bg-amber-900/40 text-amber-300 border-amber-700 hover:border-amber-400'
                }`}>
                {p.job.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="bg-terminal-surface border border-terminal-border rounded-lg overflow-hidden">
        {/* Day headers */}
        <div className="grid border-b border-terminal-border" style={{ gridTemplateColumns: '4.5rem repeat(7, 1fr)' }}>
          <div className="p-2 text-xs text-terminal-dim border-r border-terminal-border" />
          {DAY_LABELS.map((day, i) => {
            const isToday = DAY_OF_WEEK[i] === today;
            return (
              <div key={day} className={`p-2 text-center text-xs font-mono font-bold border-r border-terminal-border last:border-r-0 ${
                isToday ? 'text-terminal-green bg-terminal-green/5' : 'text-terminal-amber'
              }`}>
                {day}
                {isToday && <div className="w-1 h-1 bg-terminal-green rounded-full mx-auto mt-0.5" />}
              </div>
            );
          })}
        </div>

        {/* Hour rows */}
        {GRID_HOURS.map((hour, rowIdx) => (
          <div key={hour}
            className={`grid border-b border-terminal-border last:border-b-0 ${rowIdx % 2 === 0 ? '' : 'bg-terminal-bg/30'}`}
            style={{ gridTemplateColumns: '4.5rem repeat(7, 1fr)', minHeight: '2.5rem' }}
          >
            <div className="p-1.5 text-xs text-terminal-dim font-mono border-r border-terminal-border flex items-center justify-center">
              {formatTime(hour, 0)}
            </div>
            {DAY_LABELS.map((_, dayIdx) => (
              <div key={dayIdx} className="p-1 border-r border-terminal-border last:border-r-0 flex flex-wrap gap-0.5 items-start content-start">
                {gridMap[hour][dayIdx].map(p => (
                  <button key={p.job.id} onClick={() => onSelect(p)}
                    title={`${p.job.name} — ${p.humanSchedule}`}
                    className={`w-2.5 h-2.5 rounded-full transition-all hover:scale-125 ${dotColor[p.type]} ${
                      selected?.job.id === p.job.id ? 'ring-2 ring-white scale-125' : ''
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* One-shot section */}
      {oneshotCrons.length > 0 && (
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-3">
          <div className="text-xs text-terminal-dim font-mono font-bold mb-2 uppercase tracking-widest">🎯 One-shot / Upcoming</div>
          <div className="flex flex-wrap gap-2">
            {oneshotCrons.map(p => (
              <button key={p.job.id} onClick={() => onSelect(p)}
                className={`px-2 py-1 rounded text-xs font-mono border transition-all ${
                  selected?.job.id === p.job.id
                    ? 'bg-gray-500 text-white border-gray-400'
                    : 'bg-gray-800/40 text-terminal-dim border-gray-700 hover:border-gray-500'
                }`}>
                {p.job.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-terminal-dim text-center">Click any dot or chip for details</p>
    </div>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({ parsedCrons, typeLabel, statusDot, onSelect, selected }: {
  parsedCrons: ParsedCron[];
  typeLabel: Record<string, string>;
  statusDot: (s: string) => string;
  onSelect: (p: ParsedCron) => void;
  selected: ParsedCron | null;
}) {
  const dotColor: Record<string, string> = {
    hourly: 'bg-amber-500', daily: 'bg-blue-500', weekday: 'bg-green-500',
    weekend: 'bg-purple-500', oneshot: 'bg-gray-500', other: 'bg-gray-400',
  };

  return (
    <div className="space-y-1.5">
      {parsedCrons.map(p => (
        <button key={p.job.id} onClick={() => onSelect(p)}
          className={`w-full text-left flex items-center gap-3 p-3 rounded-lg border transition-all ${
            selected?.job.id === p.job.id
              ? `${p.bgColor} ${p.borderColor}`
              : 'bg-terminal-surface border-terminal-border hover:border-terminal-dim'
          }`}
        >
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${dotColor[p.type]}`} />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-sm text-terminal-text truncate">{p.job.name}</div>
            <div className={`text-xs font-mono mt-0.5 ${p.color}`}>{p.humanSchedule}</div>
          </div>
          <div className="hidden sm:block flex-shrink-0">
            <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${p.bgColor} ${p.borderColor} ${p.color}`}>
              {typeLabel[p.type] ?? p.type}
            </span>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-xs font-mono">{statusDot(p.job.status)} {p.job.status}</div>
            {p.job.lastRunAtMs && (
              <div className="text-xs text-terminal-dim mt-0.5">{formatRelativeMs(p.job.lastRunAtMs)}</div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ parsed, typeLabel, statusDot, onClose }: {
  parsed: ParsedCron;
  typeLabel: Record<string, string>;
  statusDot: (s: string) => string;
  onClose: () => void;
}) {
  const { job } = parsed;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const firesOn =
    parsed.type === 'hourly'  ? 'All days (every hour)'
    : parsed.type === 'oneshot' ? 'N/A'
    : parsed.days.length === 0  ? 'All days'
    : parsed.days.map(d => dayNames[d]).join(', ');

  return (
    <div className={`mt-6 p-4 rounded-lg border ${parsed.bgColor} ${parsed.borderColor} animate-fadeIn`}>
      <div className="flex items-start justify-between mb-4">
        <h3 className={`font-mono font-bold text-lg ${parsed.color}`}>{job.name}</h3>
        <button onClick={onClose} className="text-terminal-dim hover:text-terminal-text text-xl leading-none ml-4">×</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs font-mono">
        {[
          ['Type',       typeLabel[parsed.type] ?? parsed.type],
          ['Schedule',   parsed.humanSchedule],
          ['Fires On',   firesOn],
          ['Status',     `${statusDot(job.status)} ${job.status}`],
          ['Last Run',   formatRelativeMs(job.lastRunAtMs)],
          ['Next Run',   formatRelativeMs(job.nextRunAtMs)],
          ...(job.target ? [['Target', job.target]] : []),
          ...(job.tz     ? [['Timezone', job.tz]]  : []),
        ].map(([label, val]) => (
          <div key={label}>
            <div className="text-terminal-dim uppercase tracking-widest mb-1">{label}</div>
            <div className="text-terminal-text">{val}</div>
          </div>
        ))}
        <div className="col-span-2 sm:col-span-3">
          <div className="text-terminal-dim uppercase tracking-widest mb-1">Raw Expression</div>
          <div className="text-terminal-dim break-all">{job.schedule || '—'}</div>
        </div>
      </div>
    </div>
  );
}
