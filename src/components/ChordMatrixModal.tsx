'use client';

import { ForwardRefExoticComponent, RefAttributes } from 'react';
import dynamic from 'next/dynamic';
import type { ChordDiagramHandle, ChordDiagramProps, ChordTriggerEvent } from '@/components/ChordDiagram';

const ChordDiagram = dynamic(
  () => import('@/components/ChordDiagram'),
  { ssr: false }
) as ForwardRefExoticComponent<ChordDiagramProps & RefAttributes<ChordDiagramHandle>>;

interface ChordMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
  diagramRef: React.RefObject<ChordDiagramHandle | null>;
  onChordTriggered: (event: ChordTriggerEvent) => void;
}

export default function ChordMatrixModal({
  isOpen,
  onClose,
  diagramRef,
  onChordTriggered,
}: ChordMatrixModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-y-auto mx-4">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="text-2xl font-bold text-slate-900">Chord Matrix</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          <p className="text-sm text-slate-600 mb-4">
            Click on any chord to play and add it to your progression
          </p>
          <ChordDiagram ref={diagramRef} onChordTriggered={onChordTriggered} />
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-6 py-4 flex justify-end rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
