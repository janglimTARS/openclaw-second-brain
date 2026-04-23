'use client';

import { useEffect, useState } from 'react';

interface HealthResult {
  name: string;
  url: string;
  category: string;
  status: 'UP' | 'DOWN' | 'SLOW' | 'ACCESS_GATED';
  statusCode: number;
  responseTimeMs: number;
  checkedAt: string;
}

interface HealthPayload {
  checkedAt: string;
  total: number;
  upCount: number;
  uptimePercent: number;
  averageResponseMs: number;
  results: HealthResult[];
}

function classifyDotColor(status: string) {
  switch (status) {
    case 'UP': return 'bg-emerald-400';
    case 'SLOW': return 'bg-amber-400';
    case 'ACCESS_GATED': return 'bg-blue-400';
    default: return 'bg-rose-400';
  }
}

function classifyStatusText(status: string) {
  switch (status) {
    case 'UP': return 'UP';
    case 'SLOW': return 'SLOW';
    case 'ACCESS_GATED': return 'ACCESS GATED';
    default: return 'DOWN';
  }
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function HealthDashboard() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as HealthPayload;
      setData(payload);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch health data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-terminal-muted animate-pulse tracking-wide">Loading health data…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-terminal-dim">{error || 'No data available'}</div>
        <button onClick={fetchHealth} className="ml-3 px-3 py-1 rounded border border-terminal-border text-xs text-terminal-green hover:bg-terminal-panel transition-colors">
          Retry
        </button>
      </div>
    );
  }

  const grouped = data.results.reduce<Record<string, HealthResult[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const categoryOrder = ['Local', 'Public', 'Workers', 'Operations'];
  const sortedCategories = categoryOrder.filter((c) => grouped[c]);

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto p-4 md:p-8">

        <div className="mb-6 pb-4 border-b border-terminal-border flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs text-terminal-dim mb-1 uppercase tracking-widest">Operations</div>
            <h1 className="text-2xl md:text-3xl font-bold text-terminal-green font-mono">🛰️ Mission Control Health</h1>
            <p className="text-sm text-terminal-dim mt-1">
              {data.upCount}/{data.total} systems up · {data.uptimePercent.toFixed(1)}% uptime · avg {Math.round(data.averageResponseMs)} ms
            </p>
          </div>
          <div className="flex gap-2 sm:mt-1">
            <button
              onClick={fetchHealth}
              className="px-3 py-1.5 rounded text-sm font-mono border border-terminal-border text-terminal-dim hover:text-terminal-green hover:border-terminal-green transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="text-xs text-terminal-dim mb-4">
          Last check: {fmtDate(data.checkedAt)}
        </div>

        {sortedCategories.map((category) => (
          <div key={category} className="mb-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-terminal-dim mb-2">
              {category}
            </div>
            <div className="space-y-1.5">
              {grouped[category].map((item) => (
                <div
                  key={item.name}
                  className="flex items-center gap-3 p-3 rounded-lg border border-terminal-border bg-terminal-surface hover:bg-terminal-panel transition-colors"
                >
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${classifyDotColor(item.status)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-terminal-text font-mono truncate">{item.name}</div>
                    <div className="text-xs text-terminal-dim truncate">{item.url}</div>
                  </div>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
                    item.status === 'UP' ? 'border-emerald-500/40 text-emerald-300 bg-emerald-900/20'
                    : item.status === 'SLOW' ? 'border-amber-500/40 text-amber-300 bg-amber-900/20'
                    : item.status === 'ACCESS_GATED' ? 'border-blue-500/40 text-blue-300 bg-blue-900/20'
                    : 'border-rose-500/40 text-rose-300 bg-rose-900/20'
                  }`}>
                    {classifyStatusText(item.status)}
                  </span>
                  <span className="text-xs font-mono text-terminal-dim min-w-[64px] text-right">
                    {item.responseTimeMs >= 0 ? `${item.responseTimeMs} ms` : '----'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
