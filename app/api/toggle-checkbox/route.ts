import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { isAllowedFilePath } from '@/app/lib/file-index';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { filePath, lineNumber, checked } = await request.json();

    if (!filePath || typeof lineNumber !== 'number' || typeof checked !== 'boolean') {
      return NextResponse.json({ error: 'filePath, lineNumber, and checked required' }, { status: 400 });
    }

    const normalizedPath = path.resolve(path.normalize(filePath));

    if (!isAllowedFilePath(normalizedPath)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
    }

    if (!fs.existsSync(normalizedPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const content = fs.readFileSync(normalizedPath, 'utf-8');
    const lines = content.split('\n');

    if (lineNumber < 0 || lineNumber >= lines.length) {
      return NextResponse.json({ error: 'Line number out of range' }, { status: 400 });
    }

    const line = lines[lineNumber];

    if (checked) {
      // unchecked -> checked
      lines[lineNumber] = line.replace(/- \[ \]/, '- [x]');
    } else {
      // checked -> unchecked
      lines[lineNumber] = line.replace(/- \[x\]/i, '- [ ]');
    }

    fs.writeFileSync(normalizedPath, lines.join('\n'), 'utf-8');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error toggling checkbox:', error);
    return NextResponse.json({ error: 'Failed to toggle checkbox' }, { status: 500 });
  }
}
