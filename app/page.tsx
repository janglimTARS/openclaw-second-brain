'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar, { CRON_CALENDAR_PATH } from './components/Sidebar';
import ContentArea from './components/ContentArea';
import CronCalendar from './components/CronCalendar';
import SearchModal from './components/SearchModal';
import { FileNode } from './types';

export default function Home() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contentRefreshVersion, setContentRefreshVersion] = useState(0);

  const versionRef = useRef<number>(-1);

  const loadFiles = useCallback(async (): Promise<FileNode[]> => {
    const response = await fetch('/api/files', { cache: 'no-store' });
    const data = (await response.json()) as FileNode[];

    setFiles(data);
    setSelectedFile((currentSelection) => {
      if (!currentSelection) {
        return currentSelection;
      }

      const stillExists = data.some((file) => file.path === currentSelection);
      return stillExists ? currentSelection : null;
    });

    const versionHeader = response.headers.get('x-second-brain-version');
    if (versionHeader !== null) {
      const parsedVersion = Number(versionHeader);
      if (Number.isFinite(parsedVersion)) {
        versionRef.current = parsedVersion;
      }
    }

    return data;
  }, []);

  useEffect(() => {
    let mounted = true;

    loadFiles()
      .catch((error) => {
        console.error('Failed to load files:', error);
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      mounted = false;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [loadFiles]);

  useEffect(() => {
    let cancelled = false;

    const checkForUpdates = async () => {
      try {
        const response = await fetch('/api/updates', { cache: 'no-store' });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { version?: number };
        const latestVersion = payload.version;

        if (typeof latestVersion !== 'number') {
          return;
        }

        if (latestVersion !== versionRef.current) {
          await loadFiles();

          if (!cancelled) {
            setContentRefreshVersion(latestVersion);
          }
        }
      } catch (error) {
        console.error('Failed to check for updates:', error);
      }
    };

    const intervalId = window.setInterval(() => {
      void checkForUpdates();
    }, 3000);

    void checkForUpdates();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loadFiles]);

  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
    setSearchOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar files={files} onFileSelect={handleFileSelect} selectedFile={selectedFile} />
      {selectedFile === CRON_CALENDAR_PATH ? (
        <CronCalendar />
      ) : (
        <ContentArea selectedFile={selectedFile} refreshVersion={contentRefreshVersion} />
      )}
      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onFileSelect={handleFileSelect}
      />

      {loading && (
        <div className="fixed inset-0 bg-terminal-bg/80 flex items-center justify-center">
          <div className="text-terminal-green animate-pulse">Loading index...</div>
        </div>
      )}
    </div>
  );
}
