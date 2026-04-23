import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ServiceCheck {
  name: string;
  url: string;
  category: string;
}

const LOCAL_SERVICES: ServiceCheck[] = [
  { name: 'Second Brain', url: 'http://localhost:3333/api/updates', category: 'Local' },
  { name: 'LinkCast', url: 'http://localhost:3456', category: 'Local' },
  { name: 'Health Dashboard', url: 'http://localhost:3401/api/daily', category: 'Local' },
  { name: 'Bloomberg Terminal', url: 'https://bloomberg-terminal.jackanglim3.workers.dev', category: 'Workers' },
  { name: 'Falcon Markup', url: 'https://falcon-markup.jackanglim3.workers.dev', category: 'Workers' },
];

const PUBLIC_SERVICES: ServiceCheck[] = [
  { name: 'Jaccuweather', url: 'https://weather.janglim.cloud', category: 'Public' },
  { name: 'BTC Power Law', url: 'https://btc.janglim.cloud', category: 'Public' },
  { name: 'MEP Code Search', url: 'https://mep.janglim.cloud', category: 'Public' },
  { name: 'DuctFlow', url: 'https://ducts.janglim.cloud', category: 'Public' },
  { name: 'JAnglim Math', url: 'https://math.janglim.cloud', category: 'Public' },
  { name: 'MEP Wiki', url: 'https://wiki.janglim.cloud', category: 'Public' },
  { name: 'Pipe Sizing', url: 'https://pipes.janglim.cloud', category: 'Public' },
  { name: 'LinkCast', url: 'https://linkcast.janglim.cloud', category: 'Public' },
  { name: 'Filament Manager', url: 'https://printing.janglim.cloud', category: 'Public' },
  { name: 'Golf Dashboard', url: 'https://golf.janglim.cloud', category: 'Public' },
  { name: 'Air Quality', url: 'https://air.janglim.cloud', category: 'Public' },
  { name: 'WordRoot', url: 'https://wordroot.janglim.cloud', category: 'Public' },
  { name: 'Food Scanner', url: 'https://food.janglim.cloud', category: 'Public' },
  { name: "Joe's Notes", url: 'https://joenotes.janglim.cloud', category: 'Public' },
  { name: 'OpenWebUI', url: 'https://ai.janglim.cloud', category: 'Public' },
  { name: 'Mission Control', url: 'https://mc.janglim.cloud', category: 'Public' },
  { name: 'Status Monitor', url: 'https://status.janglim.cloud', category: 'Operations' },
  { name: 'Stone Choir Search', url: 'https://stonechoir.janglim.cloud', category: 'Public' },
];

async function probe(url: string, timeoutMs = 4000): Promise<{ ok: boolean; status: number; statusText: string; elapsedMs: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'tars-health-check/1.0' },
    });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, statusText: res.statusText, elapsedMs: Date.now() - started };
  } catch (err: any) {
    clearTimeout(timer);
    const msg = err?.name === 'AbortError' ? 'Timeout' : String(err?.message || err || 'Request failed');
    return { ok: false, status: 0, statusText: msg, elapsedMs: Date.now() - started, error: msg };
  }
}

export async function GET() {
  const allServices = [...LOCAL_SERVICES, ...PUBLIC_SERVICES];

  const results = await Promise.all(
    allServices.map(async (svc) => {
      const head = await probe(svc.url);

      let status: 'UP' | 'DOWN' | 'SLOW' | 'ACCESS_GATED' = 'DOWN';
      let responseTimeMs = head.elapsedMs;

      if (head.status === 401 || head.status === 403) {
        status = 'ACCESS_GATED';
      } else if (head.ok && head.status >= 200 && head.status < 500) {
        status = head.elapsedMs > 2000 ? 'SLOW' : 'UP';
      } else if (head.status === 0) {
        // HEAD failed, try GET as fallback
        const get = await probe(svc.url, 4000);
        responseTimeMs = get.elapsedMs;
        if (get.status === 401 || get.status === 403) {
          status = 'ACCESS_GATED';
        } else if (get.ok && get.status >= 200 && get.status < 500) {
          status = get.elapsedMs > 2000 ? 'SLOW' : 'UP';
        } else {
          status = 'DOWN';
        }
      } else {
        // Non-ok HTTP status but not total failure
        status = 'DOWN';
      }

      return {
        name: svc.name,
        url: svc.url,
        category: svc.category,
        status,
        statusCode: head.status || 0,
        responseTimeMs,
        checkedAt: new Date().toISOString(),
      };
    })
  );

  const total = results.length;
  const upCount = results.filter((r) => r.status === 'UP' || r.status === 'SLOW' || r.status === 'ACCESS_GATED').length;
  const validTimings = results.filter((r) => r.responseTimeMs >= 0).map((r) => r.responseTimeMs);
  const averageResponseMs = validTimings.length ? validTimings.reduce((a, b) => a + b, 0) / validTimings.length : 0;

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      total,
      upCount,
      uptimePercent: total > 0 ? (upCount / total) * 100 : 0,
      averageResponseMs,
      results,
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  );
}
