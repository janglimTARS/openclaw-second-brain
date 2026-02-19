'use client';

import { useEffect, useState } from 'react';

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  next?: string | null;
  last?: string | null;
  status: string;
  target?: string;
  agent?: string;
}

interface ParsedCron {
  job: CronJob;
  type: 'hourly' | 'daily' | 'weekday' | 'weekend' | 'oneshot' | 'other';
  hour: number | null;    // 0-23, null if hourly/oneshot
  minute: number | null;
  days: number[];         // 0=Sun,1=Mon,...,6=Sat — empty means all
  humanSchedule: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

// Parse schedule strings like:
//   "cron 30 7 * * 1-5 @ America/New_York"
//   "cron 0 * * * *"
//   "at 2026-03-17 20:48Z"
function parseCron(job: CronJob): ParsedCron {
  const sched = job.schedule.trim();

  // One-shot "at" schedules
  if (sched.startsWith('at ')) {
    const dateStr = sched.replace(/^at\s+/, '').replace(/ @.*$/, '').trim();
    const d = new Date(dateStr);
    const human = isNaN(d.getTime())
      ? `One-shot: ${dateStr}`
      : `One-shot: ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}`;
    return {
      job,
      type: 'oneshot',
      hour: null,
      minute: null,
      days: [],
      humanSchedule: human,
      color: 'text-terminal-dim',
      bgColor: 'bg-gray-800',
      borderColor: 'border-gray-600',
    };
  }

  // Cron expression
  // Format: "cron M H dom M dow @ TZ"
  const cronMatch = sched.match(/^cron\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
  if (!cronMatch) {
    return {
      job,
      type: 'other',
      hour: null,
      minute: null,
      days: [],
      humanSchedule: sched,
      color: 'text-terminal-dim',
      bgColor: 'bg-gray-800',
      borderColor: 'border-gray-600',
    };
  }

  const [, minPart, hourPart, , , dowPart] = cronMatch;

  const isHourly = hourPart === '*';
  const hour = isHourly ? null : parseInt(hourPart, 10);
  const minute = minPart === '*' ? 0 : parseInt(minPart, 10);

  // Parse day-of-week
  let days: number[] = [];
  if (dowPart !== '*') {
    // e.g. "1-5", "0,6", "1,2,3,4,5"
    if (dowPart.includes('-')) {
      const [start, end] = dowPart.split('-').map(Number);
      for (let i = start; i <= end; i++) days.push(i);
    } else {
      days = dowPart.split(',').map(Number);
    }
  }

  // Determine type
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
    const isWeekend = days.length === 2 && days.includes(0) && days.includes(6);
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

  // Colors by type
  const colorMap: Record<string, { color: string; bgColor: string; borderColor: string }> = {
    hourly: { color: 'text-yellow-300', bgColor: 'bg-amber-900/40', borderColor: 'border-amber-500' },
    daily: { color: 'text-blue-300', bgColor: 'bg-blue-900/40', borderColor: 'border-blue-500' },
    weekday: { color: 'text-green-300', bgColor: 'bg-green-900/40', borderColor: 'border-green-600' },
    weekend: { color: 'text-purple-300', bgColor: 'bg-purple-900/40', borderColor: 'border-purple-500' },
    oneshot: { color: 'text-terminal-dim', bgColor: 'bg-gray-800/40', borderColor: 'border-gray-600' },
    other: { color: 'text-terminal-text', bgColor: 'bg-gray-800/40', borderColor: 'border-gray-600' },
  };

  return {
    job,
    type,
    hour,
    minute,
    days,
    humanSchedule,
    ...colorMap[type],
  };
}

function formatTime(hour: number, minute: number | null): string {
  const m = minute ?? 0;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatRelative(ts: string | null | undefined): string {
  if (!ts) return '—';

  // Handle "Xh ago", "Xd ago" style strings from the API
  if (/^\d/.test(ts) && ts.includes('ago')) return ts;
  if (ts.startsWith('in ')) return ts;

  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const diff = Date.now() - d.getTime();
    const abs = Math.abs(diff);
    if (abs < 60000) return 'just now';
    if (abs < 3600000) return `${Math.round(abs / 60000)}m ago`;
    if (abs < 86400000) return `${Math.round(abs / 3600000)}h ago`;
    return `${Math.round(abs / 86400000)}d ago`;
  } catch {
    return ts;
  }
}

// Which calendar days does this job fire on? Returns bitmask of 0-6 (Sun=0)
function firesOnDay(parsed: ParsedCron, dayOfWeek: number): boolean {
  if (parsed.type === 'oneshot') return false;
  if (parsed.type === 'hourly') return true;
  if (parsed.days.length === 0) return true; // daily = all days
  return parsed.days.includes(dayOfWeek);
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_OF_WEEK = [1, 2, 3, 4, 5, 6, 0]; // Mon=1...Sun=0

// Hours to show in weekly grid
const GRID_HOURS = [1, 4, 7, 8, 9, 10, 11, 12, 14, 17, 19, 22];

export default function CronCalendar() {
  const [parsedCrons, setParsedCrons] = useState<ParsedCron[]>([]);
  const [source, setSource] = useState<'live' | 'fallback' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
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
      .catch(err => {
        setError(String(err));
        setSource('fallback');
      });
  }, []);

  const sortedCrons = [...parsedCrons].sort((a, b) => {
    // Sort by hour, then minute
    const aH = a.hour ?? -1;
    const bH = b.hour ?? -1;
    if (aH !== bH) return aH - bH;
    return (a.minute ?? 0) - (b.minute ?? 0);
  });

  const typeLabel: Record<string, string> = {
    hourly: '⚡ Hourly',
    daily: '🌀 Daily',
    weekday: '📅 Weekday',
    weekend: '🌅 Weekend',
    oneshot: '🎯 One-shot',
    other: '⚙️ Custom',
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto p-8">
        {/* Header */}
        <div className="mb-6 pb-4 border-b border-terminal-border flex items-center justify-between">
          <div>
            <div className="text-xs text-terminal-dim mb-1 uppercase tracking-widest">Automation</div>
            <h1 className="text-3xl font-bold text-terminal-green font-mono">🕐 Cron Calendar</h1>
            <p className="text-sm text-terminal-dim mt-1">
              {source === 'loading' && 'Fetching cron jobs…'}
              {source === 'live' && `${parsedCrons.length} active jobs • live data`}
              {source === 'fallback' && `${parsedCrons.length} jobs • fallback data`}
              {error && ` • ${error}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setView('calendar')}
              className={`px-3 py-1.5 rounded text-sm font-mono border transition-colors ${
                view === 'calendar'
                  ? 'bg-terminal-green text-terminal-bg border-terminal-green'
                  : 'border-terminal-border text-terminal-dim hover:text-terminal-green hover:border-terminal-green'
              }`}
            >
              📅 Grid
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1.5 rounded text-sm font-mono border transition-colors ${
                view === 'list'
                  ? 'bg-terminal-green text-terminal-bg border-terminal-green'
                  : 'border-terminal-border text-terminal-dim hover:text-terminal-green hover:border-terminal-green'
              }`}
            >
              📋 List
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mb-6">
          {[
            { type: 'hourly', label: 'Hourly', dot: 'bg-amber-500' },
            { type: 'daily', label: 'Daily', dot: 'bg-blue-500' },
            { type: 'weekday', label: 'Weekday', dot: 'bg-green-500' },
            { type: 'weekend', label: 'Weekend', dot: 'bg-purple-500' },
            { type: 'oneshot', label: 'One-shot', dot: 'bg-gray-500' },
          ].map(({ label, dot }) => (
            <div key={label} className="flex items-center gap-1.5 text-xs text-terminal-dim">
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
          <WeeklyGrid parsedCrons={sortedCrons} onSelect={setSelectedCron} selected={selectedCron} />
        ) : (
          <ListView parsedCrons={sortedCrons} typeLabel={typeLabel} onSelect={setSelectedCron} selected={selectedCron} />
        )}

        {/* Detail Panel */}
        {selectedCron && (
          <DetailPanel parsed={selectedCron} onClose={() => setSelectedCron(null)} typeLabel={typeLabel} />
        )}
      </div>
    </div>
  );
}

// ─── Weekly Grid ────────────────────────────────────────────────────────────

function WeeklyGrid({
  parsedCrons,
  onSelect,
  selected,
}: {
  parsedCrons: ParsedCron[];
  onSelect: (p: ParsedCron | null) => void;
  selected: ParsedCron | null;
}) {
  const dotColor: Record<string, string> = {
    hourly: 'bg-amber-500',
    daily: 'bg-blue-500',
    weekday: 'bg-green-500',
    weekend: 'bg-purple-500',
    oneshot: 'bg-gray-500',
    other: 'bg-gray-500',
  };

  // Build a map: hour -> dayIndex -> [parsedCrons]
  const gridMap: Record<number, Record<number, ParsedCron[]>> = {};
  for (const h of GRID_HOURS) {
    gridMap[h] = {};
    for (let d = 0; d < 7; d++) gridMap[h][d] = [];
  }

  // Hourly crons don't slot into a specific hour row in the grid; show in header
  const hourlyCrons = parsedCrons.filter(p => p.type === 'hourly');
  const timedCrons = parsedCrons.filter(p => p.type !== 'hourly' && p.hour !== null);
  const oneshotCrons = parsedCrons.filter(p => p.type === 'oneshot');

  for (const parsed of timedCrons) {
    if (parsed.hour === null) continue;
    // Find nearest grid hour
    const nearestHour = GRID_HOURS.reduce((prev, curr) =>
      Math.abs(curr - parsed.hour!) < Math.abs(prev - parsed.hour!) ? curr : prev,
    );
    for (let d = 0; d < 7; d++) {
      if (firesOnDay(parsed, DAY_OF_WEEK[d])) {
        gridMap[nearestHour][d].push(parsed);
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Hourly bar */}
      {hourlyCrons.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-3 mb-4">
          <div className="text-xs text-amber-400 font-mono font-bold mb-2 uppercase tracking-widest">⚡ Hourly (every hour, all days)</div>
          <div className="flex flex-wrap gap-2">
            {hourlyCrons.map(p => (
              <button
                key={p.job.id}
                onClick={() => onSelect(selected?.job.id === p.job.id ? null : p)}
                className={`px-2 py-1 rounded text-xs font-mono border transition-all ${
                  selected?.job.id === p.job.id
                    ? 'bg-amber-500 text-terminal-bg border-amber-400'
                    : 'bg-amber-900/40 text-amber-300 border-amber-700 hover:border-amber-400'
                }`}
              >
                {p.job.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Weekly grid */}
      <div className="bg-terminal-surface border border-terminal-border rounded-lg overflow-hidden">
        {/* Day headers */}
        <div className="grid border-b border-terminal-border" style={{ gridTemplateColumns: '4rem repeat(7, 1fr)' }}>
          <div className="p-2 text-xs text-terminal-dim border-r border-terminal-border" />
          {DAY_LABELS.map((day, i) => {
            const today = new Date().getDay(); // 0=Sun
            const isToday = DAY_OF_WEEK[i] === today;
            return (
              <div
                key={day}
                className={`p-2 text-center text-xs font-mono font-bold border-r border-terminal-border last:border-r-0 ${
                  isToday ? 'text-terminal-green bg-terminal-green/5' : 'text-terminal-amber'
                }`}
              >
                {day}
                {isToday && <div className="w-1 h-1 bg-terminal-green rounded-full mx-auto mt-0.5" />}
              </div>
            );
          })}
        </div>

        {/* Time rows */}
        {GRID_HOURS.map((hour, rowIdx) => (
          <div
            key={hour}
            className={`grid border-b border-terminal-border last:border-b-0 ${rowIdx % 2 === 0 ? '' : 'bg-terminal-bg/30'}`}
            style={{ gridTemplateColumns: '4rem repeat(7, 1fr)', minHeight: '2.5rem' }}
          >
            {/* Hour label */}
            <div className="p-1.5 text-xs text-terminal-dim font-mono border-r border-terminal-border flex items-center justify-center">
              {formatTime(hour, 0)}
            </div>
            {/* Day cells */}
            {DAY_LABELS.map((_, dayIdx) => {
              const cellCrons = gridMap[hour][dayIdx];
              return (
                <div
                  key={dayIdx}
                  className="p-1 border-r border-terminal-border last:border-r-0 flex flex-wrap gap-1 items-start"
                >
                  {cellCrons.map(p => (
                    <button
                      key={p.job.id}
                      onClick={() => onSelect(selected?.job.id === p.job.id ? null : p)}
                      title={`${p.job.name} — ${p.humanSchedule}`}
                      className={`w-2.5 h-2.5 rounded-full transition-all hover:scale-125 ${dotColor[p.type]} ${
                        selected?.job.id === p.job.id ? 'ring-2 ring-white scale-125' : ''
                      }`}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* One-shot section */}
      {oneshotCrons.length > 0 && (
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-3 mt-4">
          <div className="text-xs text-terminal-dim font-mono font-bold mb-2 uppercase tracking-widest">🎯 One-shot / Upcoming</div>
          <div className="flex flex-wrap gap-2">
            {oneshotCrons.map(p => (
              <button
                key={p.job.id}
                onClick={() => onSelect(selected?.job.id === p.job.id ? null : p)}
                className={`px-2 py-1 rounded text-xs font-mono border transition-all ${
                  selected?.job.id === p.job.id
                    ? 'bg-gray-500 text-white border-gray-400'
                    : 'bg-gray-800/40 text-terminal-dim border-gray-700 hover:border-gray-500'
                }`}
              >
                {p.job.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-terminal-dim text-center mt-2">
        Click any dot or job chip to see details
      </p>
    </div>
  );
}

// ─── List View ───────────────────────────────────────────────────────────────

function ListView({
  parsedCrons,
  typeLabel,
  onSelect,
  selected,
}: {
  parsedCrons: ParsedCron[];
  typeLabel: Record<string, string>;
  onSelect: (p: ParsedCron | null) => void;
  selected: ParsedCron | null;
}) {
  const dotColor: Record<string, string> = {
    hourly: 'bg-amber-500',
    daily: 'bg-blue-500',
    weekday: 'bg-green-500',
    weekend: 'bg-purple-500',
    oneshot: 'bg-gray-500',
    other: 'bg-gray-500',
  };

  return (
    <div className="space-y-2">
      {parsedCrons.map(p => (
        <button
          key={p.job.id}
          onClick={() => onSelect(selected?.job.id === p.job.id ? null : p)}
          className={`w-full text-left flex items-center gap-3 p-3 rounded-lg border transition-all ${
            selected?.job.id === p.job.id
              ? `${p.bgColor} ${p.borderColor}`
              : 'bg-terminal-surface border-terminal-border hover:border-terminal-dim'
          }`}
        >
          {/* Dot */}
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${dotColor[p.type]}`} />

          {/* Name + schedule */}
          <div className="flex-1 min-w-0">
            <div className="font-mono text-sm text-terminal-text truncate">{p.job.name}</div>
            <div className={`text-xs font-mono mt-0.5 ${p.color}`}>{p.humanSchedule}</div>
          </div>

          {/* Type badge */}
          <div className="flex-shrink-0 hidden sm:block">
            <span className={`text-xs px-2 py-0.5 rounded border font-mono ${p.bgColor} ${p.borderColor} ${p.color}`}>
              {typeLabel[p.type] ?? p.type}
            </span>
          </div>

          {/* Status */}
          <div className="flex-shrink-0 text-right">
            <span className={`text-xs font-mono ${
              p.job.status === 'ok' ? 'text-terminal-green' :
              p.job.status === 'idle' ? 'text-terminal-dim' :
              'text-red-400'
            }`}>
              {p.job.status === 'ok' ? '✓ ok' : p.job.status === 'idle' ? '◌ idle' : `✗ ${p.job.status}`}
            </span>
            {p.job.last && (
              <div className="text-xs text-terminal-dim mt-0.5">{formatRelative(p.job.last)}</div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  parsed,
  onClose,
  typeLabel,
}: {
  parsed: ParsedCron;
  onClose: () => void;
  typeLabel: Record<string, string>;
}) {
  const { job } = parsed;

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const firesOn =
    parsed.type === 'hourly' ? 'All days (every hour)'
    : parsed.type === 'oneshot' ? 'N/A'
    : parsed.days.length === 0 ? 'All days'
    : parsed.days.map(d => dayNames[d]).join(', ');

  return (
    <div className={`mt-6 p-4 rounded-lg border ${parsed.bgColor} ${parsed.borderColor} animate-fadeIn`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className={`font-mono font-bold text-lg ${parsed.color}`}>{job.name}</h3>
        <button
          onClick={onClose}
          className="text-terminal-dim hover:text-terminal-text text-lg leading-none ml-4"
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-terminal-dim uppercase tracking-widest mb-1">Type</div>
          <div className={parsed.color}>{typeLabel[parsed.type] ?? parsed.type}</div>
        </div>
        <div>
          <div className="text-terminal-dim uppercase tracking-widest mb-1">Schedule</div>
          <div className="text-terminal-text">{parsed.humanSchedule}</div>
        </div>
        <div>
          <div className="text-terminal-dim uppercase tracking-widest mb-1">Fires On</div>
          <div className="text-terminal-text">{firesOn}</div>
        </div>
        <div>
          <div className="text-terminal-dim uppercase tracking-widest mb-1">Status</div>
          <div className={
            job.status === 'ok' ? 'text-terminal-green' :
            job.status === 'idle' ? 'text-terminal-dim' :
            'text-red-400'
          }>
            {job.status === 'ok' ? '✓ ok' : job.status === 'idle' ? '◌ idle' : `✗ ${job.status}`}
          </div>
        </div>
        <div>
          <div className="text-terminal-dim uppercase tracking-widest mb-1">Last Run</div>
          <div className="text-terminal-text">{formatRelative(job.last)}</div>
        </div>
        <div>
          <div className="text-terminal-dim uppercase tracking-widest mb-1">Next Run</div>
          <div className="text-terminal-text">{formatRelative(job.next)}</div>
        </div>
        {job.target && (
          <div>
            <div className="text-terminal-dim uppercase tracking-widest mb-1">Target</div>
            <div className="text-terminal-text">{job.target}</div>
          </div>
        )}
        <div className="col-span-2 sm:col-span-3">
          <div className="text-terminal-dim uppercase tracking-widest mb-1">Raw Schedule</div>
          <div className="text-terminal-dim break-all">{job.schedule}</div>
        </div>
      </div>
    </div>
  );
}
