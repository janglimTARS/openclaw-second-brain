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

// Build components factory that includes checkbox handling
function buildMdComponents(content: string | null, filePath: string | null, onToggle: (lineNumber: number, checked: boolean) => void) {
  // Pre-compute a map: for each checkbox occurrence index, what's the source line number?
  const checkboxLineMap: number[] = [];
  if (content) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*-\s+\[([ xX])\]/.test(lines[i])) {
        checkboxLineMap.push(i);
      }
    }
  }
  let checkboxIndex = 0;

  return {
  h1: ({node, ...props}: any) => <h1 className="text-2xl md:text-3xl font-semibold text-terminal-text mb-5 mt-8 font-display" {...props} />,
  h2: ({node, ...props}: any) => <h2 className="text-xl md:text-2xl font-semibold text-terminal-text mb-3 mt-7 font-display" {...props} />,
  h3: ({node, ...props}: any) => <h3 className="text-lg md:text-xl font-semibold text-terminal-muted mb-2 mt-6 font-display" {...props} />,
  p: ({node, ...props}: any) => <p className="mb-4 leading-8 text-terminal-text text-[15px] md:text-base" {...props} />,
  ul: ({node, ...props}: any) => <ul className="list-disc list-inside mb-5 space-y-2 text-terminal-text text-[15px] md:text-base" {...props} />,
  ol: ({node, ...props}: any) => <ol className="list-decimal list-inside mb-5 space-y-2 text-terminal-text text-[15px] md:text-base" {...props} />,
  li: ({node, children, ...props}: any) => {
    // Detect task list items (remark-gfm sets className="task-list-item")
    const isTask = typeof props.className === 'string' && props.className.includes('task-list-item');
    if (isTask) {
      const checked = props.checked === true || (node?.properties?.checked === true);
      return (
        <li className={`ml-4 task-list-item ${checked ? 'task-checked' : ''}`} style={{ listStyle: 'none' }} {...props}>
          {children}
        </li>
      );
    }
    return <li className="ml-4" {...props}>{children}</li>;
  },
  input: ({node, ...props}: any) => {
    if (props.type === 'checkbox') {
      const idx = checkboxIndex++;
      const lineNumber = checkboxLineMap[idx];
      const isChecked = !!props.checked;
      return (
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggle(lineNumber, !isChecked)}
          className="checkbox-interactive"
          readOnly={false}
        />
      );
    }
    return <input {...props} />;
  },
  code: ({node, inline, ...props}: any) =>
    inline
      ? <code className="bg-terminal-panel px-1.5 py-0.5 rounded-md text-terminal-green font-mono text-xs md:text-sm" {...props} />
      : <code className="block bg-terminal-panel p-3 md:p-4 rounded-lg my-5 overflow-x-auto text-xs md:text-sm font-mono text-terminal-text border border-terminal-border/80" {...props} />,
  pre: ({node, ...props}: any) => <pre className="bg-terminal-panel rounded-lg overflow-hidden my-5 border border-terminal-border/80" {...props} />,
  blockquote: ({node, ...props}: any) => <blockquote className="border-l-4 border-terminal-green/80 pl-4 italic text-terminal-muted my-5 text-sm md:text-base" {...props} />,
  a: ({node, ...props}: any) => <a className="text-terminal-green hover:text-terminal-amber underline transition-colors break-words" {...props} />,
  table: ({node, ...props}: any) => <div className="overflow-x-auto my-5 -mx-4 md:mx-0"><table className="min-w-full border border-terminal-border text-sm" {...props} /></div>,
  th: ({node, ...props}: any) => <th className="border border-terminal-border px-3 py-2 bg-terminal-panel text-terminal-muted font-semibold whitespace-nowrap" {...props} />,
  td: ({node, ...props}: any) => <td className="border border-terminal-border px-3 py-2 text-sm" {...props} />,
  hr: ({node, ...props}: any) => <hr className="border-terminal-border my-8" {...props} />,
};
}

export default function ContentArea({ selectedFile, refreshVersion, scrollToLine, onScrollComplete }: ContentAreaProps) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingScrollLine = useRef<number | undefined>(undefined);
  const lastFetchedFile = useRef<string | null>(null);
  const lastFetchedVersion = useRef<number>(-1);

  const handleCheckboxToggle = useCallback(async (lineNumber: number, checked: boolean) => {
    if (!content) return;
    // Optimistic update
    const lines = content.content.split('\n');
    if (checked) {
      lines[lineNumber] = lines[lineNumber].replace(/- \[ \]/, '- [x]');
    } else {
      lines[lineNumber] = lines[lineNumber].replace(/- \[x\]/i, '- [ ]');
    }
    setContent({ ...content, content: lines.join('\n') });

    // Persist to disk
    try {
      await fetch('/api/toggle-checkbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: content.path, lineNumber, checked }),
      });
    } catch (err) {
      console.error('Failed to persist checkbox toggle:', err);
    }
  }, [content]);

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

    // Skip fetch for PDFs - they'll be rendered in an iframe directly
    if (selectedFile.toLowerCase().endsWith('.pdf')) {
      setContent(null);
      setLoading(false);
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
        <div className="text-center glass-panel rounded-2xl px-8 py-10">
          <div className="text-5xl md:text-6xl mb-4">🧠</div>
          <div className="text-base md:text-lg text-terminal-text">Select a file from the sidebar</div>
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
        <div className="text-terminal-muted animate-pulse tracking-wide">Loading...</div>
      </div>
    );
  }

  // Check if this is a PDF file - render in iframe
  const isPDF = selectedFile?.toLowerCase().endsWith('.pdf');

  if (isPDF) {
    return (
      <div className="flex-1 overflow-hidden">
        <iframe
          src={`/api/content?path=${encodeURIComponent(selectedFile)}`}
          className="w-full h-full border-0"
          title="PDF Viewer"
        />
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
      <div className="max-w-5xl mx-auto p-4 md:p-8 lg:p-10">
        <div className="mb-5 md:mb-8 pb-5 border-b border-terminal-border/80">
          <div className="text-xs text-terminal-dim mb-2 tracking-[0.08em] uppercase">{content.category}</div>
          <h1 className="text-2xl md:text-4xl font-semibold text-terminal-text font-display break-words leading-tight">{content.name}</h1>
        </div>

        <div className="prose prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildMdComponents(content.content, content.path, handleCheckboxToggle)}>
            {content.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
