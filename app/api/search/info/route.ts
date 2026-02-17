import { NextResponse } from 'next/server';
import { getRecallIndexInfo } from '@/app/lib/recall-index';

export const dynamic = 'force-dynamic';

export async function GET() {
  const info = getRecallIndexInfo();

  return NextResponse.json(info, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
