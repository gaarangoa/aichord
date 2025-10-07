'use client';

import dynamic from 'next/dynamic';

const ChordDiagram = dynamic(() => import('@/components/ChordDiagram'), {
  ssr: false
});

export default function Home() {
  return (
    <div className="font-sans min-h-screen p-8 pb-20">
      <main className="flex flex-col items-center w-full max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Chord Progression Network</h1>
        <div className="w-full aspect-square relative">
          <ChordDiagram />
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
            <p className="text-sm text-gray-600">Click anywhere to initialize the piano...</p>
          </div>
        </div>
        <div className="text-center max-w-2xl mt-8">
          <p className="text-lg mb-4">
            This diagram shows the relationships between major and minor chords in the Circle of Fifths.
          </p>
          <ul className="text-sm space-y-2">
            <li>
              <span className="inline-block w-3 h-3 rounded-full bg-[#60a5fa] mr-2"></span>
              Blue nodes represent major chords
            </li>
            <li>
              <span className="inline-block w-3 h-3 rounded-full bg-[#f87171] mr-2"></span>
              Red nodes represent minor chords
            </li>
            <li>
              Arrows show common chord progressions and relationships
            </li>
            <li className="mt-4 text-base">
              � Click on any chord to hear it played on a grand piano!
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}
