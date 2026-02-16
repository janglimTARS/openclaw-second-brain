import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import { SearchResult } from '@/app/types';
import { fileIndexService } from '@/app/lib/file-index';

export const dynamic = 'force-dynamic';

interface IndexedFile {
  path: string;
  name: string;
  category: string;
  content: string;
}

let searchIndex: Fuse<IndexedFile> | null = null;
let indexVersion = -1;

function buildIndex(): Fuse<IndexedFile> {
  const snapshot = fileIndexService.getSnapshot();
  const files: IndexedFile[] = [];

  for (const file of snapshot.files) {
    // Keep search focused on markdown content to preserve existing behavior/performance.
    if (!file.path.endsWith('.md')) {
      continue;
    }

    try {
      const stat = fs.statSync(file.path);
      if (!stat.isFile()) {
        continue;
      }

      const content = fs.readFileSync(file.path, 'utf-8');
      files.push({
        path: file.path,
        name: path.basename(file.path),
        category: file.category,
        content,
      });
    } catch (error) {
      console.error(`[second-brain] Error indexing ${file.path}:`, error);
    }
  }

  indexVersion = snapshot.version;

  return new Fuse(files, {
    keys: [
      { name: 'name', weight: 2 },
      { name: 'content', weight: 1 },
    ],
    threshold: 0.4,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
}

function ensureSearchIndex(): Fuse<IndexedFile> {
  const snapshot = fileIndexService.getSnapshot();

  if (!searchIndex || snapshot.version !== indexVersion) {
    searchIndex = buildIndex();
  }

  return searchIndex;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || query.trim().length < 2) {
    return NextResponse.json([]);
  }

  const activeSearchIndex = ensureSearchIndex();
  const results = activeSearchIndex.search(query).slice(0, 20);

  const searchResults: SearchResult[] = results.map((result) => {
    const item = result.item;

    const queryLower = query.toLowerCase();
    const contentLower = item.content.toLowerCase();
    const matchIndex = contentLower.indexOf(queryLower);

    let excerpt = '';
    if (matchIndex !== -1) {
      const start = Math.max(0, matchIndex - 60);
      const end = Math.min(item.content.length, matchIndex + query.length + 100);
      excerpt =
        (start > 0 ? '...' : '') +
        item.content.slice(start, end).replace(/\n/g, ' ').trim() +
        (end < item.content.length ? '...' : '');
    } else {
      excerpt = `${item.content.slice(0, 150).replace(/\n/g, ' ').trim()}...`;
    }

    return {
      path: item.path,
      name: item.name,
      category: item.category,
      excerpt,
      score: result.score || 0,
    };
  });

  return NextResponse.json(searchResults, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
