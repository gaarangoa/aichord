'use client';

import { useState } from 'react';

interface SidebarProps {
  onConversationsClick: () => void;
  onChordMatrixClick: () => void;
  onSettingsClick: () => void;
}

export default function Sidebar({ onConversationsClick, onChordMatrixClick, onSettingsClick }: SidebarProps) {
  const [hoveredIcon, setHoveredIcon] = useState<string | null>(null);

  return (
    <div className="fixed left-0 top-0 h-screen w-16 bg-slate-900 shadow-lg flex flex-col items-center py-4 gap-4 z-50">
      {/* Conversations */}
      <button
        type="button"
        onClick={onConversationsClick}
        onMouseEnter={() => setHoveredIcon('conversations')}
        onMouseLeave={() => setHoveredIcon(null)}
        className="relative w-12 h-12 rounded-lg bg-slate-800 hover:bg-slate-700 transition-all flex items-center justify-center group"
        title="Conversations"
      >
        <svg
          className="w-6 h-6 text-slate-300 group-hover:text-white transition-colors"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 8h10M7 12h6m5-9H6a2 2 0 00-2 2v14l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2z"
          />
        </svg>
        {hoveredIcon === 'conversations' && (
          <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap">
            Conversations
          </div>
        )}
      </button>

      {/* Chord Matrix */}
      <button
        type="button"
        onClick={onChordMatrixClick}
        onMouseEnter={() => setHoveredIcon('matrix')}
        onMouseLeave={() => setHoveredIcon(null)}
        className="relative w-12 h-12 rounded-lg bg-slate-800 hover:bg-slate-700 transition-all flex items-center justify-center group"
        title="Chord Matrix"
      >
        <svg
          className="w-6 h-6 text-slate-300 group-hover:text-white transition-colors"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
          />
        </svg>
        {hoveredIcon === 'matrix' && (
          <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap">
            Chord Matrix
          </div>
        )}
      </button>

      {/* Settings */}
      <button
        type="button"
        onClick={onSettingsClick}
        onMouseEnter={() => setHoveredIcon('settings')}
        onMouseLeave={() => setHoveredIcon(null)}
        className="relative w-12 h-12 rounded-lg bg-slate-800 hover:bg-slate-700 transition-all flex items-center justify-center group"
        title="Settings"
      >
        <svg
          className="w-6 h-6 text-slate-300 group-hover:text-white transition-colors"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        {hoveredIcon === 'settings' && (
          <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap">
            Settings
          </div>
        )}
      </button>
    </div>
  );
}
