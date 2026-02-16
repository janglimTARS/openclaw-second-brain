import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import chokidar, { FSWatcher } from 'chokidar';
import { FileNode } from '@/app/types';

function expandHomeDirectory(inputPath: string): string {
  if (inputPath === '~') {
    return os.homedir();
  }

  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function resolveConfigPath(inputPath: string): string {
  return path.resolve(path.normalize(expandHomeDirectory(inputPath)));
}

const DEFAULT_OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
const DEFAULT_WORKSPACE_ROOT = path.join(DEFAULT_OPENCLAW_HOME, 'workspace');

export const OPENCLAW_HOME = resolveConfigPath(
  process.env.OPENCLAW_HOME || DEFAULT_OPENCLAW_HOME
);
export const WORKSPACE_ROOT = resolveConfigPath(
  process.env.OPENCLAW_WORKSPACE || DEFAULT_WORKSPACE_ROOT
);
export const MEMORY_DIR = resolveConfigPath(
  process.env.OPENCLAW_MEMORY_DIR || path.join(WORKSPACE_ROOT, 'memory')
);
export const CONVERSATIONS_DIR = resolveConfigPath(
  process.env.OPENCLAW_CONVERSATIONS_DIR || path.join(WORKSPACE_ROOT, 'conversations')
);
export const SESSIONS_DIR = resolveConfigPath(
  process.env.OPENCLAW_SESSIONS_DIR || path.join(OPENCLAW_HOME, 'agents', 'main', 'sessions')
);

const WORKSPACE_DOCS = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'RULES.md',
  'TOOLS.md',
  'AGENTS.md',
  'HEARTBEAT.md',
] as const;

const LONG_TERM_FILE = 'MEMORY.md';
const WORKSPACE_DOC_SET = new Set<string>(WORKSPACE_DOCS);
const EXCLUDED_REPORT_NAMES = new Set<string>([...WORKSPACE_DOCS, LONG_TERM_FILE]);

const WATCH_TARGETS = [
  { target: WORKSPACE_ROOT, depth: 0 },
  { target: MEMORY_DIR, depth: 5 },
  { target: CONVERSATIONS_DIR, depth: 5 },
  { target: SESSIONS_DIR, depth: 2 },
] as const;

interface FileSnapshot {
  version: number;
  updatedAt: number;
  files: FileNode[];
}

function normalize(inputPath: string): string {
  return path.resolve(path.normalize(inputPath));
}

function isHidden(name: string): boolean {
  return name.startsWith('.');
}

function isWorkspaceRootFile(filePath: string): boolean {
  return normalize(path.dirname(filePath)) === normalize(WORKSPACE_ROOT);
}

function scanMarkdownDirectory(dirPath: string, category: string): FileNode[] {
  const files: FileNode[] = [];

  if (!fs.existsSync(dirPath)) {
    return files;
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      if (isHidden(entry.name) || !entry.name.endsWith('.md')) {
        continue;
      }

      files.push({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        category,
        type: 'file',
      });
    }
  } catch (error) {
    console.error(`[second-brain] Failed to scan ${dirPath}:`, error);
  }

  return files;
}

function scanWorkspaceReports(): FileNode[] {
  const files: FileNode[] = [];

  if (!fs.existsSync(WORKSPACE_ROOT)) {
    return files;
  }

  try {
    const entries = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      if (isHidden(entry.name) || !entry.name.endsWith('.md') || EXCLUDED_REPORT_NAMES.has(entry.name)) {
        continue;
      }

      files.push({
        name: entry.name,
        path: path.join(WORKSPACE_ROOT, entry.name),
        category: 'Reports',
        type: 'file',
      });
    }
  } catch (error) {
    console.error('[second-brain] Failed to scan workspace reports:', error);
  }

  return files;
}

function scanSessionTranscripts(): FileNode[] {
  const files: FileNode[] = [];

  if (!fs.existsSync(SESSIONS_DIR)) {
    return files;
  }

  try {
    const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      if (isHidden(entry.name) || !entry.name.endsWith('.jsonl') || entry.name.includes('.deleted.')) {
        continue;
      }

      files.push({
        name: entry.name,
        path: path.join(SESSIONS_DIR, entry.name),
        category: 'Sessions',
        type: 'file',
      });
    }
  } catch (error) {
    console.error('[second-brain] Failed to scan session transcripts:', error);
  }

  return files;
}

function scanAllFiles(): FileNode[] {
  const allFiles: FileNode[] = [];

  allFiles.push(...scanMarkdownDirectory(MEMORY_DIR, 'Memory'));
  allFiles.push(...scanMarkdownDirectory(CONVERSATIONS_DIR, 'Conversations'));

  const longTermPath = path.join(WORKSPACE_ROOT, LONG_TERM_FILE);
  if (fs.existsSync(longTermPath)) {
    allFiles.push({
      name: LONG_TERM_FILE,
      path: longTermPath,
      category: 'Long-term',
      type: 'file',
    });
  }

  for (const docName of WORKSPACE_DOCS) {
    const docPath = path.join(WORKSPACE_ROOT, docName);

    if (!fs.existsSync(docPath)) {
      continue;
    }

    allFiles.push({
      name: docName,
      path: docPath,
      category: 'Workspace Docs',
      type: 'file',
    });
  }

  allFiles.push(...scanWorkspaceReports());
  allFiles.push(...scanSessionTranscripts());

  return allFiles;
}

function isTrackedFile(filePath: string): boolean {
  const normalizedPath = normalize(filePath);
  const basename = path.basename(normalizedPath);

  if (!basename || isHidden(basename) || basename.includes('.deleted.')) {
    return false;
  }

  const memoryRoot = `${normalize(MEMORY_DIR)}${path.sep}`;
  const conversationsRoot = `${normalize(CONVERSATIONS_DIR)}${path.sep}`;
  const sessionsRoot = `${normalize(SESSIONS_DIR)}${path.sep}`;

  if (normalizedPath.startsWith(memoryRoot) || normalizedPath.startsWith(conversationsRoot)) {
    return basename.endsWith('.md');
  }

  if (isWorkspaceRootFile(normalizedPath)) {
    return basename.endsWith('.md');
  }

  if (normalizedPath.startsWith(sessionsRoot)) {
    return basename.endsWith('.jsonl');
  }

  return false;
}

class FileIndexService {
  private snapshot: FileSnapshot = {
    version: 0,
    updatedAt: Date.now(),
    files: [],
  };

  private watchers: FSWatcher[] = [];
  private emitter = new EventEmitter();
  private rebuildTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.rebuildIndex();
    this.startWatcher();
  }

  getSnapshot(): FileSnapshot {
    return {
      version: this.snapshot.version,
      updatedAt: this.snapshot.updatedAt,
      files: [...this.snapshot.files],
    };
  }

  subscribe(listener: (snapshot: FileSnapshot) => void): () => void {
    this.emitter.on('change', listener);
    return () => {
      this.emitter.off('change', listener);
    };
  }

  private startWatcher(): void {
    if (this.watchers.length > 0) {
      return;
    }

    const schedule = (changedPath: string) => {
      if (!isTrackedFile(changedPath)) {
        return;
      }

      this.scheduleRebuild();
    };

    for (const watchTarget of WATCH_TARGETS) {
      if (!fs.existsSync(watchTarget.target)) {
        continue;
      }

      const watcher = chokidar.watch(watchTarget.target, {
        ignoreInitial: true,
        persistent: true,
        depth: watchTarget.depth,
        awaitWriteFinish: {
          stabilityThreshold: 250,
          pollInterval: 100,
        },
        ignored: (watchPath: string) => {
          const basename = path.basename(watchPath);
          return basename.startsWith('.') || basename.includes('.deleted.');
        },
      });

      watcher
        .on('add', schedule)
        .on('change', schedule)
        .on('unlink', schedule)
        .on('error', (error: unknown) => {
          console.error('[second-brain] File watcher error:', error);
        });

      this.watchers.push(watcher);
    }
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }

    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuildIndex();
    }, 150);
  }

  private rebuildIndex(): void {
    const files = scanAllFiles();

    this.snapshot = {
      version: this.snapshot.version + 1,
      updatedAt: Date.now(),
      files,
    };

    this.emitter.emit('change', this.getSnapshot());
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __secondBrainFileIndexService: FileIndexService | undefined;
}

function getFileIndexService(): FileIndexService {
  if (!globalThis.__secondBrainFileIndexService) {
    globalThis.__secondBrainFileIndexService = new FileIndexService();
  }

  return globalThis.__secondBrainFileIndexService;
}

export const fileIndexService = getFileIndexService();

export function getCategoryForPath(filePath: string): string {
  const normalizedPath = normalize(filePath);
  const memoryRoot = `${normalize(MEMORY_DIR)}${path.sep}`;
  const conversationsRoot = `${normalize(CONVERSATIONS_DIR)}${path.sep}`;
  const sessionsRoot = `${normalize(SESSIONS_DIR)}${path.sep}`;

  if (normalizedPath.startsWith(memoryRoot)) {
    return 'Memory';
  }

  if (normalizedPath.startsWith(conversationsRoot)) {
    return 'Conversations';
  }

  if (normalizedPath === normalize(path.join(WORKSPACE_ROOT, LONG_TERM_FILE))) {
    return 'Long-term';
  }

  if (isWorkspaceRootFile(normalizedPath) && WORKSPACE_DOC_SET.has(path.basename(normalizedPath))) {
    return 'Workspace Docs';
  }

  if (normalizedPath.startsWith(sessionsRoot)) {
    return 'Sessions';
  }

  return 'Reports';
}

export function isAllowedFilePath(filePath: string): boolean {
  const normalizedPath = normalize(filePath);
  const allowedRoots = [
    normalize(WORKSPACE_ROOT),
    normalize(MEMORY_DIR),
    normalize(CONVERSATIONS_DIR),
    normalize(SESSIONS_DIR),
  ];

  const inAllowedRoot = allowedRoots.some(
    (root) => normalizedPath === root || normalizedPath.startsWith(`${root}${path.sep}`)
  );

  if (!inAllowedRoot) {
    return false;
  }

  const basename = path.basename(normalizedPath);

  if (isHidden(basename) || basename.includes('.deleted.')) {
    return false;
  }

  return true;
}
