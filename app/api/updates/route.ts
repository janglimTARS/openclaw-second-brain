import { NextResponse } from 'next/server';
import { fileIndexService } from '@/app/lib/file-index';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = fileIndexService.getSnapshot();

  return NextResponse.json(
    {
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}
