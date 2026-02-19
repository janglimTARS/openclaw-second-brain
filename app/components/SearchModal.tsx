'use client';

import { useState, useEffect, useRef } from 'react';
import { SearchResult } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: (path: string) => void;
}

export default function SearchModal({ isOpen, onClose, onFileSelect }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
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
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
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
    }, 150);

    return () => clearTimeout(debounce);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      onFileSelect(results[selectedIndex].path);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-[10vh] md:pt-[20vh] z-50 animate-fadeIn px-4 md:px-0"
      onClick={onClose}
    >
      <div 
        className="bg-terminal-surface border border-terminal-green rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden animate-slideDown"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-terminal-border">
          <span className="text-terminal-green text-lg">🔍</span>
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
              key={result.path}
              onClick={() => onFileSelect(result.path)}
              className={`w-full text-left p-4 border-b border-terminal-border transition-colors min-h-[52px] ${
                index === selectedIndex
                  ? 'bg-terminal-border'
                  : 'hover:bg-terminal-bg'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="font-bold text-terminal-green text-sm">{result.name}</div>
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

        <div className="p-3 border-t border-terminal-border bg-terminal-bg text-xs text-terminal-dim flex gap-4">
          <span className="hidden md:inline"><kbd className="px-1.5 py-0.5 bg-terminal-surface rounded border border-terminal-border">↑↓</kbd> navigate</span>
          <span className="hidden md:inline"><kbd className="px-1.5 py-0.5 bg-terminal-surface rounded border border-terminal-border">⏎</kbd> select</span>
          <span><kbd className="px-1.5 py-0.5 bg-terminal-surface rounded border border-terminal-border">ESC</kbd> close</span>
          <span className="md:hidden text-terminal-dim">Tap a result to open</span>
        </div>
      </div>
    </div>
  );
}
