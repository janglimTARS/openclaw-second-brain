'use client';

import { FileNode } from '../types';
import { useState } from 'react';

export const CRON_CALENDAR_PATH = '__cron_calendar__';

interface SidebarProps {
  files: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile: string | null;
  isOpen?: boolean;
  onClose?: () => void;
}

const categoryOrder = ['Memory', 'Hermes Memory', 'Conversations', 'Hermes Conversations', 'Golf', 'Hermes Golf', 'FE Study', 'Hermes FE Study', 'Research', 'Hermes Research', 'Project Ideas', 'Hermes Project Ideas', 'Knowledge', 'Hermes Knowledge', 'Miscellaneous', 'Hermes Miscellaneous', 'Skills', 'Skills (Bundled)', 'Long-term', 'Hermes Long-term', 'Workspace Docs', 'Hermes Workspace Docs', 'Reports', 'Hermes Reports', 'Sessions'];
const categoryIcons: Record<string, string> = {
  'Memory': '🧠',
  'Hermes Memory': '🧠',
  'Conversations': '💬',
  'Hermes Conversations': '💬',
  'Golf': '⛳',
  'Hermes Golf': '⛳',
  'FE Study': '📚',
  'Hermes FE Study': '📚',
  'Research': '🔍',
  'Hermes Research': '🔍',
  'Project Ideas': '💡',
  'Hermes Project Ideas': '💡',
  'Knowledge': '🧭',
  'Hermes Knowledge': '🧭',
  'Miscellaneous': '📁',
  'Hermes Miscellaneous': '📁',
  'Skills': '🔧',
  'Skills (Bundled)': '📦',
  'Long-term': '💾',
  'Hermes Long-term': '💾',
  'Workspace Docs': '📄',
  'Hermes Workspace Docs': '📄',
  'Reports': '📊',
  'Hermes Reports': '📊',
  'Sessions': '🗂️',
};

export default function Sidebar({ files, onFileSelect, selectedFile, isOpen = false, onClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    categoryOrder.reduce((acc, category) => {
      acc[category] = true;
      return acc;
    }, {} as Record<string, boolean>)
  );

  const toggleCategory = (category: string) => {
    setCollapsed(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const groupedFiles = files.reduce((acc, file) => {
    if (!acc[file.category]) {
      acc[file.category] = [];
    }
    acc[file.category].push(file);
    return acc;
  }, {} as Record<string, FileNode[]>);

  const sortedCategories = categoryOrder.filter(cat => groupedFiles[cat]);

  return (
    // Desktop: always visible in the flex row
    // Mobile: fixed slide-in drawer, z-40, toggled by isOpen
    <div className={[
      'glass-panel border-r border-terminal-border flex flex-col h-full',
      // Desktop: static in flow
      'md:relative md:w-[21rem] md:translate-x-0 md:flex',
      // Mobile: fixed drawer
      'fixed inset-y-0 left-0 z-40 w-80 max-w-[92vw] transition-transform duration-300 ease-in-out',
      isOpen ? 'translate-x-0' : '-translate-x-full',
    ].join(' ')}>
      <div className="px-5 py-4 border-b border-terminal-border flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-terminal-text font-display tracking-tight">Second Brain</h1>
          <p className="text-xs text-terminal-dim mt-1 hidden md:block">⌘K to search</p>
        </div>
        {/* Close button — only visible on mobile */}
        <button
          onClick={onClose}
          className="md:hidden p-2 text-terminal-dim hover:text-terminal-text transition-colors text-xl leading-none rounded-md hover:bg-terminal-bg/60"
          aria-label="Close menu"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-5">
        {/* Cron Calendar nav item */}
        <div>
          <button
            onClick={() => onFileSelect(CRON_CALENDAR_PATH)}
            className={`flex items-center gap-2.5 w-full text-left text-sm px-3 py-2.5 rounded-lg border transition-colors ${
              selectedFile === CRON_CALENDAR_PATH
                ? 'bg-terminal-panel border-terminal-green/60 text-terminal-text shadow-sm'
                : 'border-terminal-border/50 text-terminal-muted hover:bg-terminal-panel hover:text-terminal-text'
            }`}
          >
            <span>🕐</span>
            <span className="font-semibold tracking-wide">Cron Calendar</span>
          </button>
        </div>

        {sortedCategories.map(category => (
          <div key={category}>
            <button
              onClick={() => toggleCategory(category)}
              className="flex items-center gap-2 w-full text-left text-[11px] font-semibold tracking-[0.09em] uppercase text-terminal-dim hover:text-terminal-muted transition-colors mb-2 py-1"
            >
              <span>{categoryIcons[category]}</span>
              <span>{category.toUpperCase()}</span>
              <span className="ml-auto text-terminal-dim">
                {collapsed[category] ? '▸' : '▾'}
              </span>
            </button>
            
            {!collapsed[category] && (
              <div className="ml-4 space-y-1.5">
                {groupedFiles[category]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(file => (
                    <button
                      key={file.path}
                      onClick={() => onFileSelect(file.path)}
                      className={`block w-full text-left text-[13px] px-2.5 py-2 rounded-md transition-colors truncate ${
                        selectedFile === file.path
                          ? 'bg-terminal-panel text-terminal-text border border-terminal-border'
                          : 'text-terminal-muted hover:bg-terminal-bg/60 hover:text-terminal-text'
                      }`}
                      title={file.name}
                    >
                      {file.name}
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-terminal-border text-xs text-terminal-dim">
        <div className="tracking-wide">{files.length} files indexed</div>
      </div>
    </div>
  );
}
