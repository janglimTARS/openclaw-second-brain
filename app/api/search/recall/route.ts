import { NextResponse } from 'next/server';
import type { FuseResult } from 'fuse.js';
import {
  getRecallSearchIndex,
  type RecallCategory,
  type RecallDocument,
} from '@/app/lib/recall-index';

export const dynamic = 'force-dynamic';

interface RecallSearchRequestBody {
  query?: unknown;
  limit?: unknown;
  categories?: unknown;
  date_from?: unknown;
  date_to?: unknown;
}

interface RecallSearchResponse {
  path: string;
  name: string;
  category: RecallCategory;
  excerpt: string;
  score: number;
  context: string;
}

const CATEGORY_ALIASES: Record<string, RecallCategory[]> = {
  memory: ['Memory'],
  conversations: ['Conversations'],
  workspace: ['Workspace'],
  sessions: ['Sessions'],
  reports: ['Workspace'],
  'workspace docs': ['Workspace'],
  'workspace-docs': ['Workspace'],
  'long-term': ['Workspace'],
  longterm: ['Workspace'],
};

function normalizeLimit(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(50, Math.max(1, Math.floor(value)));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.min(50, Math.max(1, Math.floor(parsed)));
    }
  }

  return 10;
}

function normalizeCategories(input: unknown): Set<RecallCategory> | null {
  if (input === undefined || input === null) {
    return null;
  }

  if (!Array.isArray(input)) {
    throw new Error('categories must be an array of strings');
  }

  if (input.length === 0) {
    return null;
  }

  const normalized = new Set<RecallCategory>();

  for (const entry of input) {
    if (typeof entry !== 'string') {
      throw new Error('categories must only contain strings');
    }

    const key = entry.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const mappedCategories = CATEGORY_ALIASES[key];
    if (!mappedCategories) {
      throw new Error(`unsupported category: ${entry}`);
    }

    for (const category of mappedCategories) {
      normalized.add(category);
    }
  }

  return normalized.size > 0 ? normalized : null;
}

function parseDateBoundary(input: unknown, fieldName: 'date_from' | 'date_to'): number | null {
  if (input === undefined || input === null) {
    return null;
  }

  if (typeof input !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  const value = input.trim();
  if (!value) {
    return null;
  }

  const dayOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayOnlyMatch) {
    const year = Number(dayOnlyMatch[1]);
    const month = Number(dayOnlyMatch[2]);
    const day = Number(dayOnlyMatch[3]);

    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new Error(`${fieldName} must be a valid date`);
    }

    if (fieldName === 'date_from') {
      return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    }

    return Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${fieldName} must be a valid date`);
  }

  return parsed;
}

function getMatchIndex(result: FuseResult<RecallDocument>, query: string): number {
  const contentMatch = result.matches?.find(
    (match) => match.key === 'content' && match.indices.length > 0
  );

  if (contentMatch && contentMatch.indices.length > 0) {
    return contentMatch.indices[0][0];
  }

  const fallback = result.item.content.toLowerCase().indexOf(query.toLowerCase());
  return fallback >= 0 ? fallback : 0;
}

function buildExcerpt(content: string, matchIndex: number, queryLength: number, maxChars = 300): string {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return '';
  }

  if (normalizedContent.length <= maxChars) {
    return normalizedContent.replace(/\s+/g, ' ').trim();
  }

  const safeIndex = Math.min(Math.max(matchIndex, 0), normalizedContent.length - 1);
  const contextRadius = Math.max(120, Math.floor((maxChars - queryLength) / 2));

  let start = Math.max(0, safeIndex - contextRadius);
  let end = Math.min(normalizedContent.length, start + maxChars);

  if (end - start < maxChars && start > 0) {
    start = Math.max(0, end - maxChars);
  }

  let excerpt = normalizedContent.slice(start, end).replace(/\s+/g, ' ').trim();

  if (start > 0) {
    excerpt = `...${excerpt}`;
  }

  if (end < normalizedContent.length) {
    excerpt = `${excerpt}...`;
  }

  return excerpt;
}

function extractMarkdownParagraph(content: string, matchIndex: number): string {
  const safeIndex = Math.min(Math.max(matchIndex, 0), Math.max(0, content.length - 1));
  const paragraphStartBoundary = content.lastIndexOf('\n\n', safeIndex);
  const paragraphEndBoundary = content.indexOf('\n\n', safeIndex);

  const paragraphStart = paragraphStartBoundary === -1 ? 0 : paragraphStartBoundary + 2;
  const paragraphEnd = paragraphEndBoundary === -1 ? content.length : paragraphEndBoundary;

  let paragraph = content.slice(paragraphStart, paragraphEnd).trim();

  if (!paragraph) {
    const fallbackStart = Math.max(0, safeIndex - 400);
    const fallbackEnd = Math.min(content.length, safeIndex + 400);
    paragraph = content.slice(fallbackStart, fallbackEnd).trim();
  }

  if (!paragraph) {
    return '';
  }

  const isHeadingOnly = /^#{1,6}\s/.test(paragraph);
  if ((isHeadingOnly || paragraph.length < 80) && paragraphEnd < content.length) {
    const nextParagraphStart = content.startsWith('\n\n', paragraphEnd)
      ? paragraphEnd + 2
      : paragraphEnd;
    const nextParagraphEndBoundary = content.indexOf('\n\n', nextParagraphStart);
    const nextParagraphEnd = nextParagraphEndBoundary === -1 ? content.length : nextParagraphEndBoundary;
    const nextParagraph = content.slice(nextParagraphStart, nextParagraphEnd).trim();

    if (nextParagraph) {
      paragraph = `${paragraph}\n\n${nextParagraph}`;
    }
  }

  return paragraph;
}

function extractMarkdownSection(content: string, matchIndex: number): string | null {
  const headingRegex = /^(#{1,6})\s+.+$/gm;
  const headings: Array<{ start: number; level: number }> = [];

  for (let match = headingRegex.exec(content); match; match = headingRegex.exec(content)) {
    headings.push({
      start: match.index,
      level: match[1].length,
    });
  }

  if (headings.length === 0) {
    return null;
  }

  let sectionStart = 0;
  let sectionEnd = content.length;

  if (matchIndex < headings[0].start) {
    sectionStart = 0;
    sectionEnd = headings[0].start;
  } else {
    let activeHeadingIndex = 0;

    for (let index = 0; index < headings.length; index += 1) {
      if (headings[index].start <= matchIndex) {
        activeHeadingIndex = index;
      } else {
        break;
      }
    }

    const activeHeading = headings[activeHeadingIndex];
    sectionStart = activeHeading.start;

    for (let index = activeHeadingIndex + 1; index < headings.length; index += 1) {
      if (headings[index].level <= activeHeading.level) {
        sectionEnd = headings[index].start;
        break;
      }
    }
  }

  const section = content.slice(sectionStart, sectionEnd).trim();
  if (!section) {
    return null;
  }

  if (section.length > 2500) {
    return null;
  }

  return section;
}

function normalizeContext(context: string, maxChars = 2200): string {
  const trimmed = context.trim();

  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxChars).trim()}...`;
}

function buildContext(item: RecallDocument, matchIndex: number): string {
  if (item.kind === 'session') {
    return normalizeContext(item.contextSource || item.content);
  }

  const section = extractMarkdownSection(item.content, matchIndex);
  if (section) {
    return normalizeContext(section);
  }

  return normalizeContext(extractMarkdownParagraph(item.content, matchIndex));
}

function isWithinDateRange(item: RecallDocument, dateFromMs: number | null, dateToMs: number | null): boolean {
  if (dateFromMs === null && dateToMs === null) {
    return true;
  }

  if (item.timestampMs === null) {
    return false;
  }

  if (dateFromMs !== null && item.timestampMs < dateFromMs) {
    return false;
  }

  if (dateToMs !== null && item.timestampMs > dateToMs) {
    return false;
  }

  return true;
}

export async function POST(request: Request) {
  let body: RecallSearchRequestBody;

  try {
    body = (await request.json()) as RecallSearchRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length < 2) {
    return NextResponse.json({ error: 'query must be at least 2 characters' }, { status: 400 });
  }

  const limit = normalizeLimit(body.limit);

  let categoryFilter: Set<RecallCategory> | null = null;
  let dateFromMs: number | null = null;
  let dateToMs: number | null = null;

  try {
    categoryFilter = normalizeCategories(body.categories);
    dateFromMs = parseDateBoundary(body.date_from, 'date_from');
    dateToMs = parseDateBoundary(body.date_to, 'date_to');
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Invalid request body',
      },
      { status: 400 }
    );
  }

  if (dateFromMs !== null && dateToMs !== null && dateFromMs > dateToMs) {
    return NextResponse.json({ error: 'date_from must be before or equal to date_to' }, { status: 400 });
  }

  const searchIndex = getRecallSearchIndex();
  const searchLimit = Math.max(limit * 25, 200);
  const rawResults = searchIndex.fuse.search(query, { limit: searchLimit });

  const filteredResults = rawResults
    .filter((result) => {
      if (categoryFilter && !categoryFilter.has(result.item.category)) {
        return false;
      }

      return isWithinDateRange(result.item, dateFromMs, dateToMs);
    })
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, limit);

  const response: RecallSearchResponse[] = filteredResults.map((result) => {
    const matchIndex = getMatchIndex(result, query);

    return {
      path: result.item.path,
      name: result.item.name,
      category: result.item.category,
      excerpt: buildExcerpt(result.item.content, matchIndex, query.length, 300),
      score: result.score ?? 0,
      context: buildContext(result.item, matchIndex),
    };
  });

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Second-Brain-Version': String(searchIndex.version),
      'X-Second-Brain-Updated-At': String(searchIndex.updatedAt),
    },
  });
}
