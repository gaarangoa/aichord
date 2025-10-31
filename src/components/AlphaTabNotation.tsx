'use client';

import { useEffect, useRef } from 'react';
import type { Note } from '@coderline/alphatab';
import { AlphaTabApi, Settings } from '@coderline/alphatab';

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
  const initRef = useRef(false);

  useEffect(() => {
    // Only initialize once
    if (initRef.current || !containerRef.current || !alphaTex) {
      return;
    }
    initRef.current = true;

    console.log('[AlphaTab] Initializing once...');

    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.fontDirectory = '/alphatab/font/';
    settings.core.useWorkers = false;

    const api = new AlphaTabApi(containerRef.current, settings);

    console.log('[AlphaTab] Loading notation...');
    api.tex(alphaTex);

    if (onReady) {
      onReady(api);
    }

    // No cleanup - let it live for the entire page lifecycle
  }, []); // Empty deps - only run once ever

  if (!alphaTex) {
    return (
      <div className="w-full p-8 text-center text-gray-500 border border-gray-200 rounded-lg bg-white">
        No notation to display
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{
        minHeight: '300px',
        border: '1px solid #e5e7eb',
        borderRadius: '0.5rem',
        padding: '1rem',
        backgroundColor: '#ffffff',
      }}
    />
  );
}
