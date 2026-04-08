'use client';

import { useState, useEffect, useRef } from 'react';
import { SearchResult } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: (path: string, line?: number) => void;
}

type SearchMode = 'text' | 'keyword' | 'semantic';

const MODE_CONFIG: Record<SearchMode, { label: string; debounceMs: number }> = {
  text: { label: 'Text', debounceMs: 150 },
  keyword: { label: 'Keyword', debounceMs: 150 },
  semantic: { label: 'Semantic', debounceMs: 300 },
};

export default function SearchModal({ isOpen, onClose, onFileSelect }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('keyword');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setMode('keyword');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const debounce = setTimeout(() => {
      setLoading(true);
      const endpoint =
        mode === 'text'
          ? `/api/search?q=${encodeURIComponent(query)}`
          : `/api/semantic-search?q=${encodeURIComponent(query)}&mode=${mode}`;

      fetch(endpoint)
        .then(res => res.json())
        .then(data => {
          setResults(data);
          setSelectedIndex(0);
          setLoading(false);
        })
        .catch(err => {
          console.error('Search failed:', err);
          setLoading(false);
        });
    }, MODE_CONFIG[mode].debounceMs);

    return () => clearTimeout(debounce);
  }, [query, mode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      onFileSelect(results[selectedIndex].path, results[selectedIndex].line);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-[10vh] md:pt-[16vh] z-50 animate-fadeIn px-4 md:px-0"
      onClick={onClose}
    >
      <div 
        className="glass-panel rounded-2xl w-full max-w-3xl overflow-hidden animate-slideDown"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-col gap-4 p-5 border-b border-terminal-border">
          <div className="flex items-center gap-2">
            {(['text', 'keyword', 'semantic'] as const).map((modeOption) => (
              <button
                key={modeOption}
                type="button"
                onClick={() => setMode(modeOption)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                  mode === modeOption
                    ? 'border-terminal-green/70 text-terminal-text bg-terminal-panel'
                    : 'border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-dim'
                }`}
              >
                {MODE_CONFIG[modeOption].label}
              </button>
            ))}
            <span className="ml-auto text-[11px] uppercase tracking-wide text-terminal-dim">
              Mode: {MODE_CONFIG[mode].label}
            </span>
          </div>

          <div className="flex items-center gap-3 bg-terminal-bg/55 border border-terminal-border rounded-xl px-3 py-2.5">
            <span className="text-terminal-dim text-lg">🔍</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search your second brain..."
              className="flex-1 bg-transparent outline-none text-terminal-text placeholder-terminal-dim text-base"
            />
            {loading && <span className="text-terminal-dim animate-pulse">...</span>}
            <kbd className="hidden md:inline px-2 py-1 text-xs bg-terminal-bg rounded border border-terminal-border text-terminal-dim">ESC</kbd>
          </div>
        </div>

        <div className="max-h-[60vh] md:max-h-96 overflow-y-auto scrollbar-thin">
          {results.length === 0 && query.trim() && !loading && (
            <div className="p-8 text-center text-terminal-dim">
              No results found for "{query}"
            </div>
          )}

          {results.length === 0 && !query.trim() && (
            <div className="p-8 text-center text-terminal-dim">
              <div className="text-4xl mb-2">⌨️</div>
              <div>Start typing to search...</div>
            </div>
          )}

          {results.map((result, index) => (
            <button
              key={`${result.path}-${index}`}
              onClick={() => onFileSelect(result.path, result.line)}
              className={`w-full text-left p-4 border-b border-terminal-border/80 transition-colors min-h-[56px] ${
                index === selectedIndex
                  ? 'bg-terminal-panel'
                  : 'hover:bg-terminal-bg/60'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="font-semibold text-terminal-text text-sm">{result.name}</div>
                <div className="text-xs text-terminal-dim flex-shrink-0">{result.category}</div>
              </div>
              {result.excerpt && (
                <div className="text-sm text-terminal-text line-clamp-2">
                  {result.excerpt}
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="p-3.5 border-t border-terminal-border bg-terminal-bg/70 text-xs text-terminal-dim flex gap-4">
          <span className="hidden md:inline"><kbd className="px-1.5 py-0.5 bg-terminal-surface rounded border border-terminal-border">↑↓</kbd> navigate</span>
          <span className="hidden md:inline"><kbd className="px-1.5 py-0.5 bg-terminal-surface rounded border border-terminal-border">⏎</kbd> select</span>
          <span><kbd className="px-1.5 py-0.5 bg-terminal-surface rounded border border-terminal-border">ESC</kbd> close</span>
          <span className="hidden md:inline">search mode: {MODE_CONFIG[mode].label}</span>
          <span className="md:hidden text-terminal-dim">Tap a result to open</span>
        </div>
      </div>
    </div>
  );
}
