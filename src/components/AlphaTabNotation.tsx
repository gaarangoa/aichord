'use client';

import { useEffect, useRef } from 'react';
import type { Note } from '@coderline/alphatab';
import { AlphaTabApi } from '@coderline/alphatab';

export interface NoteLink {
  id: string;
  entryId: string;
  noteIndex: number;
  beat: number;
}

export interface AlphaTabNoteSelection {
  note: Note;
  link: NoteLink | null;
  alphaTabIndex: number;
}

interface AlphaTabNotationProps {
  alphaTex: string;
  onReady?: (api: AlphaTabApi) => void;
  noteLinks?: NoteLink[];
  onNoteSelect?: (selection: AlphaTabNoteSelection) => void;
}

export default function AlphaTabNotation({
  alphaTex,
  onReady,
}: AlphaTabNotationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitRef = useRef(false);

  useEffect(() => {
    // Only run once ever
    if (hasInitRef.current || !containerRef.current || !alphaTex) {
      return;
    }
    hasInitRef.current = true;

    console.log('[AlphaTab] Initializing once...');

    // Set text content
    containerRef.current.textContent = alphaTex;

    // Initialize
    const api = new AlphaTabApi(containerRef.current, {
      tex: true,
      core: {
        fontDirectory: '/alphatab/font/',
      },
    });

    if (onReady) {
      onReady(api);
    }

    console.log('[AlphaTab] Done');
  }, []);

  if (!alphaTex) {
    return (
      <div className="w-full p-8 text-center text-gray-500 border border-gray-200 rounded-lg bg-white">
        No notation to display
      </div>
    );
  }

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        style={{
          minHeight: '300px',
          border: '1px solid #e5e7eb',
          borderRadius: '0.5rem',
          padding: '1rem',
          backgroundColor: '#ffffff',
        }}
      />
    </div>
  );
}
