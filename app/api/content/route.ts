import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCategoryForPath, isAllowedFilePath } from '@/app/lib/file-index';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path');

  if (!filePath) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 });
  }

  const normalizedPath = path.resolve(path.normalize(filePath));

  if (!isAllowedFilePath(normalizedPath)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  try {
    if (!fs.existsSync(normalizedPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stat = fs.statSync(normalizedPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    // If it's a PDF, serve it with correct Content-Type
    if (normalizedPath.toLowerCase().endsWith('.pdf')) {
      const fileBuffer = fs.readFileSync(normalizedPath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${path.basename(normalizedPath)}"`,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }

    const content = fs.readFileSync(normalizedPath, 'utf-8');

    return NextResponse.json(
      {
        path: normalizedPath,
        name: path.basename(normalizedPath),
        category: getCategoryForPath(normalizedPath),
        content,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('Error reading file:', error);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
