import { NextResponse } from 'next/server';
import { fileIndexService } from '@/app/lib/file-index';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = fileIndexService.getSnapshot();

  return NextResponse.json(snapshot.files, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Second-Brain-Version': String(snapshot.version),
      'X-Second-Brain-Updated-At': String(snapshot.updatedAt),
    },
  });
}
