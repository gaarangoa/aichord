'use client';

import type { SessionRecord } from '@/lib/sessionStorage';
import { useMemo } from 'react';

interface ConversationsDrawerProps {
  isOpen: boolean;
  sessions: SessionRecord[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onClearCurrentSession: () => void;
  onClose: () => void;
}

const formatTimestamp = (timestamp: number): string => {
  try {
    return new Date(timestamp).toLocaleString();
  } catch (error) {
    console.error('Failed to format timestamp', error);
    return '';
  }
};

export default function ConversationsDrawer({
  isOpen,
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onClearCurrentSession,
  onClose,
}: ConversationsDrawerProps) {
  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  );

  return (
    <div
      className={`fixed inset-0 z-40 transition-all duration-300 ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      {/* Scrim */}
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/30 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label="Close conversations drawer"
      />

      <aside
        className={`absolute top-0 bottom-0 left-16 w-80 bg-white border-r border-slate-200 shadow-xl transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } flex flex-col`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">
            Conversations
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close drawer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-200 space-y-2">
          <button
            type="button"
            onClick={onCreateSession}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            + New conversation
          </button>
          <button
            type="button"
            onClick={onClearCurrentSession}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-rose-300 hover:text-rose-600"
          >
            Clear current chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-2">
          {orderedSessions.length === 0 ? (
            <p className="px-2 text-sm text-slate-500">No saved conversations yet.</p>
          ) : (
            orderedSessions.map(session => {
              const isActive = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  className={`group rounded-lg border px-3 py-2 transition ${
                    isActive
                      ? 'border-slate-900 bg-slate-900/10'
                      : 'border-transparent hover:border-slate-200 hover:bg-slate-100/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    className="w-full text-left"
                  >
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {session.name || 'Untitled conversation'}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Updated {formatTimestamp(session.updatedAt)}
                    </p>
                  </button>
                  <div className="mt-2 flex items-center justify-end opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => onDeleteSession(session.id)}
                      className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V5a1 1 0 00-1-1h-4a1 1 0 00-1 1v2M4 7h16" />
                      </svg>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
