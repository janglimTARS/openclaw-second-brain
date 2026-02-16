'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileContent } from '../types';

interface ContentAreaProps {
  selectedFile: string | null;
  refreshVersion: number;
}

export default function ContentArea({ selectedFile, refreshVersion }: ContentAreaProps) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);

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
      })
      .catch((err) => {
        console.error('Failed to load content:', err);
        setContent(null);
        setLoading(false);
      });
  }, [selectedFile, refreshVersion]);

  if (!selectedFile) {
    return (
      <div className="flex-1 flex items-center justify-center text-terminal-dim">
        <div className="text-center">
          <div className="text-6xl mb-4">🧠</div>
          <div className="text-lg">Select a file from the sidebar</div>
          <div className="text-sm mt-2">or press <kbd className="px-2 py-1 bg-terminal-surface rounded border border-terminal-border">⌘K</kbd> to search</div>
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
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto p-8">
        <div className="mb-6 pb-4 border-b border-terminal-border">
          <div className="text-xs text-terminal-dim mb-2">{content.category}</div>
          <h1 className="text-3xl font-bold text-terminal-green font-mono">{content.name}</h1>
        </div>

        <div className="prose prose-invert prose-green max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-terminal-green mb-4 mt-6 font-mono" {...props} />,
              h2: ({node, ...props}) => <h2 className="text-xl font-bold text-terminal-amber mb-3 mt-5 font-mono" {...props} />,
              h3: ({node, ...props}) => <h3 className="text-lg font-bold text-terminal-text mb-2 mt-4 font-mono" {...props} />,
              p: ({node, ...props}) => <p className="mb-4 leading-relaxed text-terminal-text" {...props} />,
              ul: ({node, ...props}) => <ul className="list-disc list-inside mb-4 space-y-2 text-terminal-text" {...props} />,
              ol: ({node, ...props}) => <ol className="list-decimal list-inside mb-4 space-y-2 text-terminal-text" {...props} />,
              li: ({node, ...props}) => <li className="ml-4" {...props} />,
              code: ({node, inline, ...props}: any) =>
                inline
                  ? <code className="bg-terminal-surface px-1.5 py-0.5 rounded text-terminal-green font-mono text-sm" {...props} />
                  : <code className="block bg-terminal-surface p-4 rounded my-4 overflow-x-auto text-sm font-mono text-terminal-green" {...props} />,
              pre: ({node, ...props}) => <pre className="bg-terminal-surface rounded overflow-hidden my-4" {...props} />,
              blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-terminal-green pl-4 italic text-terminal-dim my-4" {...props} />,
              a: ({node, ...props}) => <a className="text-terminal-green hover:text-terminal-amber underline transition-colors" {...props} />,
              table: ({node, ...props}) => <div className="overflow-x-auto my-4"><table className="min-w-full border border-terminal-border" {...props} /></div>,
              th: ({node, ...props}) => <th className="border border-terminal-border px-4 py-2 bg-terminal-surface text-terminal-amber font-bold" {...props} />,
              td: ({node, ...props}) => <td className="border border-terminal-border px-4 py-2" {...props} />,
              hr: ({node, ...props}) => <hr className="border-terminal-border my-6" {...props} />,
            }}
          >
            {content.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
