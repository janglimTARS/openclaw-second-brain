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
const DEFAULT_HERMES_HOME = path.join(os.homedir(), '.hermes');
const DEFAULT_HERMES_WORKSPACE_ROOT = path.join(DEFAULT_HERMES_HOME, 'workspace');
const DEFAULT_HERMES_MEMORIES_DIR = path.join(DEFAULT_HERMES_HOME, 'memories');

export const OPENCLAW_HOME = resolveConfigPath(
  process.env.OPENCLAW_HOME || DEFAULT_OPENCLAW_HOME
);
export const WORKSPACE_ROOT = resolveConfigPath(
  process.env.OPENCLAW_WORKSPACE || DEFAULT_WORKSPACE_ROOT
);
export const HERMES_HOME = resolveConfigPath(
  process.env.HERMES_HOME || DEFAULT_HERMES_HOME
);
export const HERMES_WORKSPACE = resolveConfigPath(
  process.env.HERMES_WORKSPACE || DEFAULT_HERMES_WORKSPACE_ROOT
);
export const HERMES_MEMORIES_DIR = resolveConfigPath(
  process.env.HERMES_MEMORIES_DIR || DEFAULT_HERMES_MEMORIES_DIR
);

// --- Hermes directories ---
export const MEMORY_DIR = resolveConfigPath(
  path.join(HERMES_HOME, 'memory')
);
export const CONVERSATIONS_DIR = resolveConfigPath(
  path.join(HERMES_WORKSPACE, 'conversations')
);
export const SESSIONS_DIR = resolveConfigPath(
  path.join(HERMES_HOME, 'sessions')
);
export const GOLF_DIR = resolveConfigPath(path.join(HERMES_WORKSPACE, 'golf'));
export const FE_STUDY_DIR = resolveConfigPath(path.join(HERMES_WORKSPACE, 'fe-study'));
export const RESEARCH_DIR = resolveConfigPath(path.join(HERMES_WORKSPACE, 'research'));
export const REPORTS_DIR = resolveConfigPath(path.join(HERMES_WORKSPACE, 'reports'));
export const PROJECT_IDEAS_DIR = resolveConfigPath(path.join(HERMES_WORKSPACE, 'project-ideas'));
export const MISCELLANEOUS_DIR = resolveConfigPath(path.join(HERMES_WORKSPACE, 'miscellaneous'));
export const KNOWLEDGE_DIR = resolveConfigPath(path.join(HERMES_WORKSPACE, 'knowledge'));

// Hermes custom skills
export const CUSTOM_SKILLS_DIR = resolveConfigPath(
  path.join(HERMES_HOME, 'skills')
);

const WORKSPACE_DOCS = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'RULES.md',
  'TOOLS.md',
  'AGENTS.md',
  'HEARTBEAT.md',
  'DREAMS.md',
] as const;

const LONG_TERM_FILE = 'MEMORY.md';
const WORKSPACE_DOC_SET = new Set<string>(WORKSPACE_DOCS);
const EXCLUDED_REPORT_NAMES = new Set<string>([...WORKSPACE_DOCS, LONG_TERM_FILE]);

const WATCH_TARGETS = [
  { target: HERMES_WORKSPACE, depth: 0 },
  { target: MEMORY_DIR, depth: 5 },
  { target: HERMES_MEMORIES_DIR, depth: 2 },
  { target: CONVERSATIONS_DIR, depth: 5 },
  { target: SESSIONS_DIR, depth: 2 },
  { target: GOLF_DIR, depth: 5 },
  { target: FE_STUDY_DIR, depth: 5 },
  { target: RESEARCH_DIR, depth: 5 },
  { target: REPORTS_DIR, depth: 5 },
  { target: PROJECT_IDEAS_DIR, depth: 5 },
  { target: MISCELLANEOUS_DIR, depth: 5 },
  { target: KNOWLEDGE_DIR, depth: 5 },
  { target: CUSTOM_SKILLS_DIR, depth: 2 },
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
  const dir = normalize(path.dirname(filePath));
  return dir === normalize(HERMES_WORKSPACE);
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

function scanMarkdownDirectoryRecursive(dirPath: string, category: string): FileNode[] {
  const files: FileNode[] = [];

  if (!fs.existsSync(dirPath)) {
    return files;
  }

  const walk = (currentDir: string) => {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (isHidden(entry.name)) {
          continue;
        }

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.md')) {
          continue;
        }

        files.push({
          name: path.relative(dirPath, fullPath),
          path: fullPath,
          category,
          type: 'file',
        });
      }
    } catch (error) {
      console.error(`[second-brain] Failed to scan ${currentDir}:`, error);
    }
  };

  walk(dirPath);
  return files;
}

function scanPDFDirectory(dirPath: string, category: string): FileNode[] {
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

      if (isHidden(entry.name) || !entry.name.endsWith('.pdf')) {
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
    console.error(`[second-brain] Failed to scan PDFs in ${dirPath}:`, error);
  }

  return files;
}

function scanSkillsDirectory(dirPath: string, category: string): FileNode[] {
  const files: FileNode[] = [];

  if (!fs.existsSync(dirPath)) {
    return files;
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (isHidden(entry.name)) {
        continue;
      }

      const skillDir = path.join(dirPath, entry.name);
      const skillEntries = fs.readdirSync(skillDir, { withFileTypes: true });

      for (const skillEntry of skillEntries) {
        if (!skillEntry.isFile()) {
          continue;
        }

        if (!skillEntry.name.endsWith('.md')) {
          continue;
        }

        // Include skill folder name in the display name (e.g., "notion/SKILL.md")
        files.push({
          name: `${entry.name}/${skillEntry.name}`,
          path: path.join(skillDir, skillEntry.name),
          category,
          type: 'file',
        });
      }
    }
  } catch (error) {
    console.error(`[second-brain] Failed to scan skills in ${dirPath}:`, error);
  }

  return files;
}

function scanWorkspaceReports(): FileNode[] {
  const files: FileNode[] = [];

  if (!fs.existsSync(HERMES_WORKSPACE)) {
    return files;
  }

  try {
    const entries = fs.readdirSync(HERMES_WORKSPACE, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      if (isHidden(entry.name) || !entry.name.endsWith('.md') || EXCLUDED_REPORT_NAMES.has(entry.name)) {
        continue;
      }

      files.push({
        name: entry.name,
        path: path.join(HERMES_WORKSPACE, entry.name),
        category: 'Reports',
        type: 'file',
      });
    }
  } catch (error) {
    console.error(`[second-brain] Failed to scan workspace reports in ${HERMES_WORKSPACE}:`, error);
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

  // Memory
  allFiles.push(...scanMarkdownDirectory(MEMORY_DIR, 'Memory'));
  allFiles.push(...scanMarkdownDirectory(HERMES_MEMORIES_DIR, 'Memory'));

  // Conversations
  allFiles.push(...scanMarkdownDirectory(CONVERSATIONS_DIR, 'Conversations'));

  // Golf
  allFiles.push(...scanMarkdownDirectory(GOLF_DIR, 'Golf'));

  // FE Study
  allFiles.push(...scanMarkdownDirectoryRecursive(FE_STUDY_DIR, 'FE Study'));

  // Research
  allFiles.push(...scanMarkdownDirectory(RESEARCH_DIR, 'Research'));

  // Reports (PDFs included)
  allFiles.push(...scanMarkdownDirectory(REPORTS_DIR, 'Reports'));

  // Project Ideas
  allFiles.push(...scanMarkdownDirectory(PROJECT_IDEAS_DIR, 'Project Ideas'));

  // Miscellaneous
  allFiles.push(...scanMarkdownDirectory(MISCELLANEOUS_DIR, 'Miscellaneous'));

  // Knowledge
  allFiles.push(...scanMarkdownDirectoryRecursive(KNOWLEDGE_DIR, 'Knowledge'));

  // PDFs
  allFiles.push(...scanPDFDirectory(REPORTS_DIR, 'Reports'));
  allFiles.push(...scanPDFDirectory(MISCELLANEOUS_DIR, 'Miscellaneous'));

  // Skills (Hermes custom only)
  allFiles.push(...scanSkillsDirectory(CUSTOM_SKILLS_DIR, 'Skills'));

  // Workspace Docs
  for (const docName of WORKSPACE_DOCS) {
    const hermesDocPath = path.join(HERMES_WORKSPACE, docName);

    if (fs.existsSync(hermesDocPath)) {
      allFiles.push({
        name: docName,
        path: hermesDocPath,
        category: 'Workspace Docs',
        type: 'file',
      });
    }
  }

  // Long-term note
  const hermesLongTermPath = path.join(HERMES_WORKSPACE, LONG_TERM_FILE);
  if (fs.existsSync(hermesLongTermPath)) {
    allFiles.push({
      name: LONG_TERM_FILE,
      path: hermesLongTermPath,
      category: 'Long-term',
      type: 'file',
    });
  }

  // Session transcripts (Hermes uses sessions/)
  allFiles.push(...scanSessionTranscripts());

  // Workspace-level markdown reports that are not core docs
  allFiles.push(...scanWorkspaceReports());

  return allFiles;
}
function isTrackedFile(filePath: string): boolean {
  const normalizedPath = normalize(filePath);
  const basename = path.basename(normalizedPath);

  if (!basename || isHidden(basename) || basename.includes('.deleted.')) {
    return false;
  }

  const memoryRoot = `${normalize(MEMORY_DIR)}${path.sep}`;
  const hermesMemoriesRoot = `${normalize(HERMES_MEMORIES_DIR)}${path.sep}`;
  const conversationsRoot = `${normalize(CONVERSATIONS_DIR)}${path.sep}`;
  const sessionsRoot = `${normalize(SESSIONS_DIR)}${path.sep}`;
  const golfRoot = `${normalize(GOLF_DIR)}${path.sep}`;
  const feStudyRoot = `${normalize(FE_STUDY_DIR)}${path.sep}`;
  const researchRoot = `${normalize(RESEARCH_DIR)}${path.sep}`;
  const projectIdeasRoot = `${normalize(PROJECT_IDEAS_DIR)}${path.sep}`;
  const miscellaneousRoot = `${normalize(MISCELLANEOUS_DIR)}${path.sep}`;
  const knowledgeRoot = `${normalize(KNOWLEDGE_DIR)}${path.sep}`;
  const customSkillsRoot = `${normalize(CUSTOM_SKILLS_DIR)}${path.sep}`;

  if (normalizedPath.startsWith(golfRoot)) {
    return basename.endsWith('.md');
  }

  if (normalizedPath.startsWith(feStudyRoot)) {
    return basename.endsWith('.md');
  }

  if (normalizedPath.startsWith(researchRoot)) {
    return basename.endsWith('.md');
  }

  if (normalizedPath.startsWith(projectIdeasRoot)) {
    return basename.endsWith('.md');
  }

  if (normalizedPath.startsWith(miscellaneousRoot)) {
    return basename.endsWith('.md') || basename.endsWith('.pdf');
  }

  if (normalizedPath.startsWith(knowledgeRoot)) {
    return basename.endsWith('.md');
  }

  const reportsRoot = `${normalize(REPORTS_DIR)}${path.sep}`;
  if (normalizedPath.startsWith(reportsRoot)) {
    return basename.endsWith('.md');
  }

  // Skills: only track Hermes custom .md files
  if (normalizedPath.startsWith(customSkillsRoot)) {
    return basename.endsWith('.md');
  }

  if (normalizedPath.startsWith(memoryRoot) || normalizedPath.startsWith(hermesMemoriesRoot) || normalizedPath.startsWith(conversationsRoot)) {
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
  private rescanTimer: NodeJS.Timeout | null = null;
  private lastKnownFiles: Set<string> = new Set();

  constructor() {
    this.rebuildIndex();
    this.startWatcher();
    this.startPeriodicRescan();
  }

  private startPeriodicRescan(): void {
    // Safety net: lightweight rescan every 60 seconds to catch any files the watcher misses
    this.rescanTimer = setInterval(() => {
      this.lightweightRescan();
    }, 60000);
  }

  private lightweightRescan(): void {
    // Quick check: compare current indexed files against what's on disk
    const currentFiles = scanAllFiles();
    const currentPaths = new Set(currentFiles.map(f => f.path));

    // Find new files that weren't in the previous snapshot
    const newFiles = currentFiles.filter(f => !this.lastKnownFiles.has(f.path));

    if (newFiles.length > 0) {
      console.log(`[second-brain] Periodic rescan found ${newFiles.length} new file(s):`, newFiles.map(f => f.name).join(', '));
      this.rebuildIndex();
    }

    // Update the known files set for next comparison
    this.lastKnownFiles = currentPaths;
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

  shutdown(): void {
    // Clean up timers and watchers
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    if (this.rescanTimer) {
      clearInterval(this.rescanTimer);
      this.rescanTimer = null;
    }
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    console.log('[second-brain] FileIndexService shutdown complete');
  }

  private startWatcher(): void {
    if (this.watchers.length > 0) {
      return;
    }

    const schedule = (changedPath: string) => {
      console.log(`[second-brain] File system event: ${changedPath}`);
      if (!isTrackedFile(changedPath)) {
        console.log(`[second-brain] Skipping untracked file: ${changedPath}`);
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

    // Initialize lastKnownFiles on first load
    if (this.lastKnownFiles.size === 0) {
      this.lastKnownFiles = new Set(files.map(f => f.path));
    }

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
  const hermesMemoriesRoot = `${normalize(HERMES_MEMORIES_DIR)}${path.sep}`;
  const conversationsRoot = `${normalize(CONVERSATIONS_DIR)}${path.sep}`;
  const sessionsRoot = `${normalize(SESSIONS_DIR)}${path.sep}`;
  const golfRoot = `${normalize(GOLF_DIR)}${path.sep}`;
  const feStudyRoot = `${normalize(FE_STUDY_DIR)}${path.sep}`;
  const researchRoot = `${normalize(RESEARCH_DIR)}${path.sep}`;
  const projectIdeasRoot = `${normalize(PROJECT_IDEAS_DIR)}${path.sep}`;
  const miscellaneousRoot = `${normalize(MISCELLANEOUS_DIR)}${path.sep}`;
  const knowledgeRoot = `${normalize(KNOWLEDGE_DIR)}${path.sep}`;
  const reportsRoot = `${normalize(REPORTS_DIR)}${path.sep}`;
  const customSkillsRoot = `${normalize(CUSTOM_SKILLS_DIR)}${path.sep}`;

  if (normalizedPath.startsWith(memoryRoot) || normalizedPath.startsWith(hermesMemoriesRoot)) {
    return 'Memory';
  }

  if (normalizedPath.startsWith(golfRoot)) {
    return 'Golf';
  }

  if (normalizedPath.startsWith(feStudyRoot)) {
    return 'FE Study';
  }

  if (normalizedPath.startsWith(researchRoot)) {
    return 'Research';
  }

  if (normalizedPath.startsWith(projectIdeasRoot)) {
    return 'Project Ideas';
  }

  if (normalizedPath.startsWith(miscellaneousRoot)) {
    return 'Miscellaneous';
  }

  if (normalizedPath.startsWith(knowledgeRoot)) {
    return 'Knowledge';
  }

  if (normalizedPath.startsWith(customSkillsRoot)) {
    return 'Skills';
  }

  if (normalizedPath.startsWith(conversationsRoot)) {
    return 'Conversations';
  }

  if (normalizedPath === normalize(path.join(HERMES_WORKSPACE, LONG_TERM_FILE))) {
    return 'Long-term';
  }

  if (isWorkspaceRootFile(normalizedPath) && WORKSPACE_DOC_SET.has(path.basename(normalizedPath))) {
    return 'Workspace Docs';
  }

  if (normalizedPath.startsWith(sessionsRoot)) {
    return 'Sessions';
  }

  if (normalizedPath.startsWith(reportsRoot)) {
    return 'Reports';
  }

  return 'Reports';
}

export function isAllowedFilePath(filePath: string): boolean {
  const normalizedPath = normalize(filePath);
  const allowedRoots = [
    normalize(HERMES_WORKSPACE),
    normalize(MEMORY_DIR),
    normalize(HERMES_MEMORIES_DIR),
    normalize(CONVERSATIONS_DIR),
    normalize(SESSIONS_DIR),
    normalize(GOLF_DIR),
    normalize(FE_STUDY_DIR),
    normalize(RESEARCH_DIR),
    normalize(REPORTS_DIR),
    normalize(PROJECT_IDEAS_DIR),
    normalize(MISCELLANEOUS_DIR),
    normalize(KNOWLEDGE_DIR),
    normalize(CUSTOM_SKILLS_DIR),
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
