import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import { NextResponse } from 'next/server';
import { SearchResult } from '@/app/types';
import { fileIndexService, getCategoryForPath, WORKSPACE_ROOT } from '@/app/lib/file-index';

export const dynamic = 'force-dynamic';

type SemanticSearchMode = 'keyword' | 'semantic';

interface IndexedFile {
  path: string;
  name: string;
  category: string;
  content: string;
}

let fallbackIndex: Fuse<IndexedFile> | null = null;
let fallbackIndexVersion = -1;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveQmdPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  const uriMatch = trimmed.match(/^([a-z]+):\/\/([^/]+)\/(.+)$/i);

  if (!uriMatch) {
    if (path.isAbsolute(trimmed)) {
      return path.resolve(path.normalize(trimmed));
    }
    return path.resolve(path.join(WORKSPACE_ROOT, trimmed));
  }

  const collection = uriMatch[2];
  const relativePath = uriMatch[3];
  return path.resolve(path.join(WORKSPACE_ROOT, collection, relativePath));
}

function parseQmdOutput(output: string): SearchResult[] {
  const blocks = output
    .split(/(?=^--- Result \d+ \(score: [^)]+\) ---$)/gm)
    .map((block) => block.trim())
    .filter(Boolean);

  const pathCategoryMap = new Map(
    fileIndexService
      .getSnapshot()
      .files.map((file) => [path.resolve(path.normalize(file.path)), file.category] as const)
  );

  const results: SearchResult[] = [];

  for (const block of blocks) {
    const scoreMatch = block.match(/--- Result \d+ \(score: ([^)]+)\) ---/);
    const fileMatch = block.match(/^File:\s*(.+)$/m);
    const contentMatch = block.match(/^Content:\s*\n([\s\S]*)$/m);

    if (!fileMatch) {
      continue;
    }

    const resolvedPath = resolveQmdPath(fileMatch[1]);
    const normalizedPath = path.resolve(path.normalize(resolvedPath));
    const name = path.basename(normalizedPath);
    const excerpt = (contentMatch?.[1] || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 320);
    const parsedScore = Number.parseFloat(scoreMatch?.[1] || '');

    results.push({
      path: normalizedPath,
      name,
      category: pathCategoryMap.get(normalizedPath) || getCategoryForPath(normalizedPath),
      excerpt,
      score: Number.isFinite(parsedScore) ? parsedScore : 0,
    });
  }

  return results;
}

function buildFallbackIndex(): Fuse<IndexedFile> {
  const snapshot = fileIndexService.getSnapshot();
  const files: IndexedFile[] = [];

  for (const file of snapshot.files) {
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
      console.error(`[second-brain] Fallback indexing failed for ${file.path}:`, error);
    }
  }

  fallbackIndexVersion = snapshot.version;

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

function ensureFallbackIndex(): Fuse<IndexedFile> {
  const snapshot = fileIndexService.getSnapshot();

  if (!fallbackIndex || snapshot.version !== fallbackIndexVersion) {
    fallbackIndex = buildFallbackIndex();
  }

  return fallbackIndex;
}

function fallbackFuseSearch(query: string): SearchResult[] {
  const activeIndex = ensureFallbackIndex();
  const results = activeIndex.search(query).slice(0, 20);

  return results.map((result) => {
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
}

function runQmdSearch(query: string, mode: SemanticSearchMode): SearchResult[] {
  const qmdBinary = '/opt/homebrew/bin/qmd';
  const subCommand = mode === 'semantic' ? 'vsearch' : 'search';
  const command = `${qmdBinary} ${subCommand} ${shellQuote(query)} -n 20`;
  const output = execSync(command, { encoding: 'utf-8' });
  return parseQmdOutput(output);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim() || '';
  const modeParam = searchParams.get('mode');
  const mode: SemanticSearchMode = modeParam === 'semantic' ? 'semantic' : 'keyword';

  if (query.length < 2) {
    return NextResponse.json([]);
  }

  try {
    const qmdResults = runQmdSearch(query, mode);
    return NextResponse.json(qmdResults, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error(`[second-brain] QMD ${mode} search failed; falling back to Fuse:`, error);
    const fallbackResults = fallbackFuseSearch(query);

    return NextResponse.json(fallbackResults, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  }
}
