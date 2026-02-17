import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import { fileIndexService } from '@/app/lib/file-index';

export type RecallCategory = 'Memory' | 'Conversations' | 'Workspace' | 'Sessions';

type SessionRole = 'user' | 'assistant';

export interface RecallDocument {
  id: string;
  kind: 'markdown' | 'session';
  path: string;
  name: string;
  category: RecallCategory;
  content: string;
  contextSource?: string;
  timestampMs: number | null;
}

export interface RecallSearchIndex {
  version: number;
  updatedAt: number;
  builtAt: number;
  documents: RecallDocument[];
  fuse: Fuse<RecallDocument>;
  totalIndexedFiles: number;
  totalIndexedSessions: number;
  categoriesAvailable: RecallCategory[];
}

export interface RecallIndexInfo {
  totalIndexedFiles: number;
  totalIndexedSessions: number;
  lastIndexUpdateTime: string;
  categoriesAvailable: RecallCategory[];
}

interface SessionMessage {
  role: SessionRole;
  text: string;
  lineNumber: number;
  timestampMs: number | null;
}

const RECALL_CATEGORY_ORDER: RecallCategory[] = [
  'Memory',
  'Conversations',
  'Workspace',
  'Sessions',
];

let recallSearchIndex: RecallSearchIndex | null = null;

function mapToRecallCategory(category: string): RecallCategory | null {
  if (category === 'Memory' || category === 'Conversations' || category === 'Sessions') {
    return category;
  }

  if (category === 'Long-term' || category === 'Workspace Docs' || category === 'Reports') {
    return 'Workspace';
  }

  return null;
}

function parseDateFromFilename(name: string): number | null {
  const match = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed.getTime();
}

function extractTextFromContentPart(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }

  if (!part || typeof part !== 'object') {
    return '';
  }

  const typedPart = part as { type?: unknown; text?: unknown };

  if (typedPart.type === 'thinking') {
    return '';
  }

  if (typeof typedPart.text === 'string') {
    return typedPart.text;
  }

  return '';
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const parts = content
    .map((part) => extractTextFromContentPart(part))
    .map((text) => text.trim())
    .filter((text) => text.length > 0);

  return parts.join('\n\n').trim();
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractSessionTimestamp(entry: Record<string, unknown>, message: Record<string, unknown>): number | null {
  const messageTimestamp = parseTimestamp(message.timestamp);
  if (messageTimestamp !== null) {
    return messageTimestamp;
  }

  return parseTimestamp(entry.timestamp);
}

function buildSessionContext(messages: SessionMessage[], centerIndex: number): string {
  const startIndex = Math.max(0, centerIndex - 2);
  const endIndex = Math.min(messages.length - 1, centerIndex + 2);

  const contextParts: string[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = messages[index];
    const roleLabel = message.role === 'user' ? 'User' : 'Assistant';
    const prefix = index === centerIndex ? '▶ ' : '';
    contextParts.push(`${prefix}${roleLabel}: ${message.text}`);
  }

  return contextParts.join('\n\n').trim();
}

function parseSessionFile(filePath: string, fileName: string): RecallDocument[] {
  let raw = '';

  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`[second-brain] Failed to read session file ${filePath}:`, error);
    return [];
  }

  const messages: SessionMessage[] = [];
  const lines = raw.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type !== 'message') {
        continue;
      }

      const message = parsed.message;
      if (!message || typeof message !== 'object') {
        continue;
      }

      const typedMessage = message as Record<string, unknown>;
      const role = typedMessage.role;
      if (role !== 'user' && role !== 'assistant') {
        continue;
      }

      const text = extractMessageText(typedMessage.content);
      if (!text) {
        continue;
      }

      messages.push({
        role,
        text,
        lineNumber: index + 1,
        timestampMs: extractSessionTimestamp(parsed, typedMessage),
      });
    } catch (error) {
      console.error(`[second-brain] Failed to parse JSONL line in ${filePath}:${index + 1}:`, error);
    }
  }

  return messages.map((message, index) => ({
    id: `${filePath}#${message.lineNumber}`,
    kind: 'session',
    path: filePath,
    name: fileName,
    category: 'Sessions',
    content: message.text,
    contextSource: buildSessionContext(messages, index),
    timestampMs: message.timestampMs,
  }));
}

function buildRecallSearchIndex(): RecallSearchIndex {
  const snapshot = fileIndexService.getSnapshot();
  const documents: RecallDocument[] = [];

  let totalIndexedFiles = 0;
  let totalIndexedSessions = 0;
  const categories = new Set<RecallCategory>();

  for (const file of snapshot.files) {
    const recallCategory = mapToRecallCategory(file.category);
    if (!recallCategory) {
      continue;
    }

    categories.add(recallCategory);

    if (file.path.endsWith('.md')) {
      try {
        const stat = fs.statSync(file.path);
        if (!stat.isFile()) {
          continue;
        }

        const content = fs.readFileSync(file.path, 'utf-8');

        documents.push({
          id: file.path,
          kind: 'markdown',
          path: file.path,
          name: path.basename(file.path),
          category: recallCategory,
          content,
          timestampMs: parseDateFromFilename(path.basename(file.path)),
        });

        totalIndexedFiles += 1;
      } catch (error) {
        console.error(`[second-brain] Failed to index markdown file ${file.path}:`, error);
      }

      continue;
    }

    if (file.path.endsWith('.jsonl') && recallCategory === 'Sessions') {
      totalIndexedSessions += 1;
      documents.push(...parseSessionFile(file.path, path.basename(file.path)));
    }
  }

  return {
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
    builtAt: Date.now(),
    documents,
    fuse: new Fuse(documents, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'content', weight: 1 },
        { name: 'contextSource', weight: 0.4 },
      ],
      threshold: 0.4,
      includeScore: true,
      includeMatches: true,
      ignoreLocation: true,
      minMatchCharLength: 2,
    }),
    totalIndexedFiles,
    totalIndexedSessions,
    categoriesAvailable: RECALL_CATEGORY_ORDER.filter((category) => categories.has(category)),
  };
}

export function getRecallSearchIndex(): RecallSearchIndex {
  const snapshot = fileIndexService.getSnapshot();

  if (!recallSearchIndex || recallSearchIndex.version !== snapshot.version) {
    recallSearchIndex = buildRecallSearchIndex();
  }

  return recallSearchIndex;
}

export function getRecallIndexInfo(): RecallIndexInfo {
  const index = getRecallSearchIndex();

  return {
    totalIndexedFiles: index.totalIndexedFiles,
    totalIndexedSessions: index.totalIndexedSessions,
    lastIndexUpdateTime: new Date(index.updatedAt).toISOString(),
    categoriesAvailable: index.categoriesAvailable,
  };
}
