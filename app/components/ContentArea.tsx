'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileContent } from '../types';

interface ContentAreaProps {
  selectedFile: string | null;
  refreshVersion: number;
  scrollToLine?: number;
  onScrollComplete?: () => void;
}

export default function ContentArea({ selectedFile, refreshVersion, scrollToLine, onScrollComplete }: ContentAreaProps) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingScrollLine = useRef<number | undefined>(undefined);

  // When scrollToLine changes, store it for after content loads
  useEffect(() => {
    if (scrollToLine !== undefined) {
      pendingScrollLine.current = scrollToLine;
    }
  }, [scrollToLine]);

  const performScroll = useCallback(() => {
    const line = pendingScrollLine.current;
    if (line === undefined || !containerRef.current) return;

    // Find the closest chunk anchor at or before the target line
    const allAnchors = Array.from(containerRef.current.querySelectorAll('[data-line]'));
    let target: Element | null = null;
    for (const el of allAnchors) {
      const elLine = parseInt(el.getAttribute('data-line') || '0', 10);
      if (elLine <= line) {
        target = el;
      } else {
        break;
      }
    }

    if (!target && allAnchors.length > 0) {
      target = allAnchors[0];
    }

    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('search-highlight');
      setTimeout(() => target!.classList.remove('search-highlight'), 2000);
    }

    pendingScrollLine.current = undefined;
    onScrollComplete?.();
  }, [content, onScrollComplete]);

  useEffect(() => {
    if (!selectedFile) {
      setContent(null);
      return;
    }

    setLoading(true);

    fetch(`/api/content?path=${encodeURIComponent(selectedFile)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load content (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        setContent(data);
        setLoading(false);
        // Scroll after content renders
        requestAnimationFrame(() => {
          requestAnimationFrame(() => performScroll());
        });
      })
      .catch((err) => {
        console.error('Failed to load content:', err);
        setContent(null);
        setLoading(false);
      });
  }, [selectedFile, refreshVersion, performScroll]);

  if (!selectedFile) {
    return (
      <div className="flex-1 flex items-center justify-center text-terminal-dim px-4">
        <div className="text-center">
          <div className="text-5xl md:text-6xl mb-4">🧠</div>
          <div className="text-base md:text-lg">Select a file from the sidebar</div>
          <div className="text-sm mt-2 hidden md:block">
            or press <kbd className="px-2 py-1 bg-terminal-surface rounded border border-terminal-border">⌘K</kbd> to search
          </div>
          <div className="text-sm mt-2 md:hidden text-terminal-dim">Tap 🔍 to search</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-terminal-green animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400">
        Failed to load content
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="mb-4 md:mb-6 pb-4 border-b border-terminal-border">
          <div className="text-xs text-terminal-dim mb-2">{content.category}</div>
          <h1 className="text-xl md:text-3xl font-bold text-terminal-green font-mono break-words">{content.name}</h1>
        </div>

        <div className="prose prose-invert prose-green max-w-none">
          {(() => {
            const lines = content.content.split('\n');
            const chunks: { startLine: number; text: string }[] = [];
            const CHUNK_SIZE = 10;

            for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
              chunks.push({
                startLine: i + 1,
                text: lines.slice(i, i + CHUNK_SIZE).join('\n'),
              });
            }

            const mdComponents = {
              h1: ({node, ...props}: any) => <h1 className="text-xl md:text-2xl font-bold text-terminal-green mb-4 mt-6 font-mono" {...props} />,
              h2: ({node, ...props}: any) => <h2 className="text-lg md:text-xl font-bold text-terminal-amber mb-3 mt-5 font-mono" {...props} />,
              h3: ({node, ...props}: any) => <h3 className="text-base md:text-lg font-bold text-terminal-text mb-2 mt-4 font-mono" {...props} />,
              p: ({node, ...props}: any) => <p className="mb-4 leading-relaxed text-terminal-text text-sm md:text-base" {...props} />,
              ul: ({node, ...props}: any) => <ul className="list-disc list-inside mb-4 space-y-2 text-terminal-text text-sm md:text-base" {...props} />,
              ol: ({node, ...props}: any) => <ol className="list-decimal list-inside mb-4 space-y-2 text-terminal-text text-sm md:text-base" {...props} />,
              li: ({node, ...props}: any) => <li className="ml-4" {...props} />,
              code: ({node, inline, ...props}: any) =>
                inline
                  ? <code className="bg-terminal-surface px-1.5 py-0.5 rounded text-terminal-green font-mono text-xs md:text-sm" {...props} />
                  : <code className="block bg-terminal-surface p-3 md:p-4 rounded my-4 overflow-x-auto text-xs md:text-sm font-mono text-terminal-green" {...props} />,
              pre: ({node, ...props}: any) => <pre className="bg-terminal-surface rounded overflow-hidden my-4" {...props} />,
              blockquote: ({node, ...props}: any) => <blockquote className="border-l-4 border-terminal-green pl-4 italic text-terminal-dim my-4 text-sm md:text-base" {...props} />,
              a: ({node, ...props}: any) => <a className="text-terminal-green hover:text-terminal-amber underline transition-colors break-words" {...props} />,
              table: ({node, ...props}: any) => <div className="overflow-x-auto my-4 -mx-4 md:mx-0"><table className="min-w-full border border-terminal-border text-sm" {...props} /></div>,
              th: ({node, ...props}: any) => <th className="border border-terminal-border px-3 py-2 bg-terminal-surface text-terminal-amber font-bold whitespace-nowrap" {...props} />,
              td: ({node, ...props}: any) => <td className="border border-terminal-border px-3 py-2 text-sm" {...props} />,
              hr: ({node, ...props}: any) => <hr className="border-terminal-border my-6" {...props} />,
            };

            return chunks.map((chunk) => (
              <div key={chunk.startLine} data-line={chunk.startLine}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {chunk.text}
                </ReactMarkdown>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}
