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

const categoryOrder = ['Memory', 'Conversations', 'Long-term', 'Workspace Docs', 'Reports', 'Sessions'];
const categoryIcons: Record<string, string> = {
  'Memory': '🧠',
  'Conversations': '💬',
  'Long-term': '💾',
  'Workspace Docs': '📄',
  'Reports': '📊',
  'Sessions': '🗂️',
};

export default function Sidebar({ files, onFileSelect, selectedFile, isOpen = false, onClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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
      'bg-terminal-surface border-r border-terminal-border flex flex-col h-full',
      // Desktop: static in flow
      'md:relative md:w-80 md:translate-x-0 md:flex',
      // Mobile: fixed drawer
      'fixed inset-y-0 left-0 z-40 w-72 transition-transform duration-300 ease-in-out',
      isOpen ? 'translate-x-0' : '-translate-x-full',
    ].join(' ')}>
      <div className="p-4 border-b border-terminal-border flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-terminal-green">SECOND BRAIN</h1>
          <p className="text-xs text-terminal-dim mt-1 hidden md:block">⌘K to search</p>
        </div>
        {/* Close button — only visible on mobile */}
        <button
          onClick={onClose}
          className="md:hidden p-2 text-terminal-dim hover:text-terminal-green transition-colors text-xl leading-none"
          aria-label="Close menu"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {/* Cron Calendar nav item */}
        <div>
          <button
            onClick={() => onFileSelect(CRON_CALENDAR_PATH)}
            className={`flex items-center gap-2 w-full text-left text-sm px-2 py-3 md:py-2 rounded border transition-colors ${
              selectedFile === CRON_CALENDAR_PATH
                ? 'bg-terminal-border border-terminal-green text-terminal-green'
                : 'border-transparent text-terminal-dim hover:bg-terminal-bg hover:text-terminal-green'
            }`}
          >
            <span>🕐</span>
            <span className="font-bold">CRON CALENDAR</span>
          </button>
        </div>

        {sortedCategories.map(category => (
          <div key={category}>
            <button
              onClick={() => toggleCategory(category)}
              className="flex items-center gap-2 w-full text-left text-sm font-bold text-terminal-amber hover:text-terminal-green transition-colors mb-2 py-1"
            >
              <span>{categoryIcons[category]}</span>
              <span>{category.toUpperCase()}</span>
              <span className="ml-auto text-terminal-dim">
                {collapsed[category] ? '▸' : '▾'}
              </span>
            </button>
            
            {!collapsed[category] && (
              <div className="ml-4 space-y-1">
                {groupedFiles[category]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(file => (
                    <button
                      key={file.path}
                      onClick={() => onFileSelect(file.path)}
                      className={`block w-full text-left text-sm px-2 py-2 md:py-1 rounded transition-colors truncate ${
                        selectedFile === file.path
                          ? 'bg-terminal-border text-terminal-green'
                          : 'text-terminal-text hover:bg-terminal-bg hover:text-terminal-green'
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
        <div>{files.length} files indexed</div>
      </div>
    </div>
  );
}
