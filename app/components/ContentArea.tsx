'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileContent } from '../types';

interface ContentAreaProps {
  selectedFile: string | null;
  refreshVersion: number;
  scrollToLine?: number;
  onScrollComplete?: () => void;
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

export default function ContentArea({ selectedFile, refreshVersion, scrollToLine, onScrollComplete }: ContentAreaProps) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingScrollLine = useRef<number | undefined>(undefined);
  const lastFetchedFile = useRef<string | null>(null);
  const lastFetchedVersion = useRef<number>(-1);

  // Store pending scroll line in ref (no re-render)
  useEffect(() => {
    if (scrollToLine !== undefined) {
      pendingScrollLine.current = scrollToLine;
    }
  }, [scrollToLine]);

  // Fetch content — depends only on selectedFile + refreshVersion
  useEffect(() => {
    if (!selectedFile) {
      setContent(null);
      lastFetchedFile.current = null;
      return;
    }

    // Avoid refetching the same file/version
    if (selectedFile === lastFetchedFile.current && refreshVersion === lastFetchedVersion.current) {
      return;
    }

    setLoading(true);

    fetch(`/api/content?path=${encodeURIComponent(selectedFile)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load content (${res.status})`);
        return res.json();
      })
      .then((data) => {
        lastFetchedFile.current = selectedFile;
        lastFetchedVersion.current = refreshVersion;
        setContent(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load content:', err);
        setContent(null);
        setLoading(false);
      });
  }, [selectedFile, refreshVersion]);

  // Scroll to line AFTER content renders — separate effect, no dependency cycle
  useEffect(() => {
    const line = pendingScrollLine.current;
    if (line === undefined || !content || !containerRef.current || loading) return;

    // Use double rAF to wait for paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;

        const totalLines = content.content.split('\n').length;
        const ratio = Math.min(line / Math.max(totalLines, 1), 1);
        const targetScrollTop = ratio * container.scrollHeight;

        container.scrollTo({ top: Math.max(0, targetScrollTop - 200), behavior: 'smooth' });

        // Flash highlight on the visible area after scrolling
        setTimeout(() => {
          if (!container) return;
          const prose = container.querySelector('.prose');
          if (prose) {
            // Find the element closest to the scroll position
            const children = prose.children;
            const containerRect = container.getBoundingClientRect();
            const midY = containerRect.top + containerRect.height / 2;

            let closestEl: Element | null = null;
            let closestDist = Infinity;

            for (let i = 0; i < children.length; i++) {
              const rect = children[i].getBoundingClientRect();
              const dist = Math.abs(rect.top - midY);
              if (dist < closestDist) {
                closestDist = dist;
                closestEl = children[i];
              }
            }

            if (closestEl) {
              closestEl.classList.add('search-highlight');
              setTimeout(() => closestEl!.classList.remove('search-highlight'), 2000);
            }
          }
        }, 500);

        pendingScrollLine.current = undefined;
        onScrollComplete?.();
      });
    });
  }, [content, loading]); // Only re-run when content finishes loading

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
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {content.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
