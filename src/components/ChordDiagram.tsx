import { useEffect, useRef, useState, useCallback, useMemo, ChangeEvent, forwardRef, useImperativeHandle } from 'react';
import { usePianoSynthesizer, type Note } from '@/lib/piano';
import { useWebMidiChordSender } from '@/lib/midi';

type ChordQuality =
  | 'major' | 'minor'
  | 'dominant7' | 'major7' | 'minor7' | 'halfDiminished7' | 'diminished7'
  | 'dominant9' | 'major9' | 'minor9'
  | 'dominant11' | 'major11' | 'minor11'
  | 'dominant13' | 'major13' | 'minor13'
  | 'augmented' | 'diminished'
  | 'sus2' | 'sus4'
  | 'add9' | 'add11';

interface ChordNode {
  id: string;
  type: ChordQuality;
  root: string;
  label: string;
}

export interface ChordTriggerEvent {
  id: string;
  root: string;
  label: string;
  type: ChordQuality;
}

export interface ChordDiagramHandle {
  playChordById: (id: string) => Promise<void>;
}

export interface ChordDiagramProps {
  onChordTriggered?: (event: ChordTriggerEvent) => void;
}

const OCTAVE_OPTIONS = [-1, 0, 1, 2, 3, 4, 5, 6] as const;
const NOTES = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'] as const;
const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  halfDiminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
  dominant9: [0, 4, 7, 10, 14],
  major9: [0, 4, 7, 11, 14],
  minor9: [0, 3, 7, 10, 14],
  dominant11: [0, 4, 7, 10, 14, 17],
  major11: [0, 4, 7, 11, 14, 17],
  minor11: [0, 3, 7, 10, 14, 17],
  dominant13: [0, 4, 7, 10, 14, 17, 21],
  major13: [0, 4, 7, 11, 14, 17, 21],
  minor13: [0, 3, 7, 10, 14, 17, 21],
  augmented: [0, 4, 8],
  diminished: [0, 3, 6],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  add11: [0, 4, 7, 17],
};

const CHORD_GROUPS: Array<{
  title: string;
  columns: Array<{ key: string; suffix: string; type: ChordQuality; display?: string }>;
}> = [
  {
    title: 'Triads',
    columns: [
      { key: 'maj', suffix: 'maj', type: 'major' },
      { key: 'min', suffix: 'min', type: 'minor' },
      { key: 'aug', suffix: 'aug', type: 'augmented' },
      { key: 'dim', suffix: 'dim', type: 'diminished' },
    ],
  },
  {
    title: 'Sevenths',
    columns: [
      { key: '7', suffix: '7', type: 'dominant7' },
      { key: 'maj7', suffix: 'maj7', type: 'major7' },
      { key: 'min7', suffix: 'min7', type: 'minor7' },
      { key: 'half-diminished', suffix: 'ø7', type: 'halfDiminished7', display: 'ø7' },
      { key: 'diminished7', suffix: '°7', type: 'diminished7', display: '°7' },
    ],
  },
  {
    title: 'Ninths',
    columns: [
      { key: '9', suffix: '9', type: 'dominant9' },
      { key: 'maj9', suffix: 'maj9', type: 'major9' },
      { key: 'min9', suffix: 'min9', type: 'minor9' },
    ],
  },
  {
    title: 'Elevenths',
    columns: [
      { key: '11', suffix: '11', type: 'dominant11' },
      { key: 'maj11', suffix: 'maj11', type: 'major11' },
      { key: 'min11', suffix: 'min11', type: 'minor11' },
    ],
  },
  {
    title: 'Suspended & Adds',
    columns: [
      { key: 'sus2', suffix: 'sus2', type: 'sus2' },
      { key: 'sus4', suffix: 'sus4', type: 'sus4' },
      { key: 'add9', suffix: 'add9', type: 'add9' },
      { key: 'add11', suffix: 'add11', type: 'add11' },
    ],
  },
];

const ChordDiagram = forwardRef<ChordDiagramHandle, ChordDiagramProps>(({ onChordTriggered }, ref) => {
  const { initialize, startContext, stopAllNotes, playChord } = usePianoSynthesizer();
  const [isSynthInitialized, setIsSynthInitialized] = useState(false);
  const [playingNode, setPlayingNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [noteDurationSeconds, setNoteDurationSeconds] = useState<number>(4);
  const [baseOctave, setBaseOctave] = useState<number>(2);
  const [velocity, setVelocity] = useState<number>(96);
  const [arpeggioIntervalMs, setArpeggioIntervalMs] = useState<number>(1);
  const [arpeggioTimingJitterPercent, setArpeggioTimingJitterPercent] = useState<number>(10);
  const [useInternalAudio, setUseInternalAudio] = useState(true);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  const {
    isSupported: isMidiSupported,
    hasAccess: hasMidiAccess,
    outputs: midiOutputs,
    selectedOutputId,
    requestAccess: requestMidiAccess,
    selectOutput: selectMidiOutput,
    sendChord: sendMidiChord,
    stopAll: stopMidiOutput,
  } = useWebMidiChordSender();
  const [midiError, setMidiError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const playbackIdRef = useRef(0);
  const controlValuesRef = useRef({
    noteDurationSeconds,
    baseOctave,
    velocity,
    arpeggioIntervalMs,
    arpeggioTimingJitterPercent,
    useInternalAudio,
  });

  const sustainSeconds = useMemo(() => Math.max(0.2, noteDurationSeconds), [noteDurationSeconds]);
  const displayHoldSeconds = useMemo(() => sustainSeconds.toFixed(2), [sustainSeconds]);

  const handleConnectMidi = useCallback(async () => {
    try {
      setMidiError(null);
      await requestMidiAccess();
    } catch (error) {
      console.error('Failed to access MIDI devices:', error);
      setMidiError(error instanceof Error ? error.message : 'Failed to access MIDI devices.');
    }
  }, [requestMidiAccess]);

  const handleDurationChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (Number.isNaN(next)) {
      return;
    }
    const clamped = Math.max(0.2, Math.min(30, next));
    setNoteDurationSeconds(clamped);
  }, []);

  const handleBaseOctaveChange = useCallback((event: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (Number.isNaN(next)) {
      return;
    }
    const clamped = Math.max(-1, Math.min(6, next));
    setBaseOctave(clamped);
  }, []);

  const handleVelocityChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (Number.isNaN(next)) {
      return;
    }
    const clamped = Math.max(1, Math.min(127, next));
    setVelocity(clamped);
  }, []);

  const handleArpeggioIntervalChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (Number.isNaN(next) || next <= 0) {
      return;
    }
    setArpeggioIntervalMs(next);
  }, []);

  const handleArpeggioJitterChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (Number.isNaN(next)) {
      return;
    }
    const clamped = Math.max(0, Math.min(100, next));
    setArpeggioTimingJitterPercent(clamped);
  }, []);

  const handleInternalAudioToggle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setUseInternalAudio(event.target.checked);
  }, []);

  const initializePiano = useCallback(async () => {
    try {
      await initialize();
      setIsSynthInitialized(true);
    } catch (error) {
      console.error('Failed to initialize internal audio:', error);
      setAudioError(error instanceof Error ? error.message : 'Failed to initialize internal audio.');
    }
  }, [initialize]);

  const ensureInternalAudioReady = useCallback(async () => {
    if (!useInternalAudio) {
      return;
    }
    try {
      setAudioError(null);
      await startContext();
      if (!isSynthInitialized) {
        await initializePiano();
      }
    } catch (error) {
      console.error('Failed to prepare internal audio:', error);
      setAudioError(error instanceof Error ? error.message : 'Failed to prepare internal audio.');
    }
  }, [initializePiano, isSynthInitialized, startContext, useInternalAudio]);

  const stopPlayback = useCallback((options?: { skipGenerationIncrement?: boolean }) => {
    if (!options?.skipGenerationIncrement) {
      playbackIdRef.current += 1;
    }
    setPlayingNode(null);
    stopMidiOutput();
    if (useInternalAudio) {
      stopAllNotes();
    }
  }, [stopMidiOutput, stopAllNotes, useInternalAudio]);

  const columnDefinitions = useMemo(
    () =>
      CHORD_GROUPS.flatMap((group, groupIndex) =>
        group.columns.map((column, columnIndex) => ({
          ...column,
          groupIndex,
          groupTitle: group.title,
          columnIndex,
        }))
      ),
    []
  );

  const matrixRows = useMemo(
    () =>
      NOTES.map(root => ({
        root,
        cells: columnDefinitions.map(column => ({
          id: `${root}${column.suffix}`,
          root,
          type: column.type,
          label: `${root}${column.suffix}`,
        } as ChordNode)),
      })),
    [columnDefinitions]
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, ChordNode>();
    matrixRows.forEach(row => {
      row.cells.forEach(cell => {
        map.set(cell.id, cell);
      });
    });
    return map;
  }, [matrixRows]);

  const startContinuousPlayback = useCallback(async (node: ChordNode) => {
    try {
      stopPlayback({ skipGenerationIncrement: true });

      const playbackId = playbackIdRef.current + 1;
      playbackIdRef.current = playbackId;
      const intervals = CHORD_INTERVALS[node.type];
      if (!intervals) {
        console.warn(`No intervals defined for chord type: ${node.type}`);
        return;
      }

      const chordDurationSeconds = sustainSeconds;
      const chordDurationMs = chordDurationSeconds * 1000;

      if (useInternalAudio) {
        await ensureInternalAudioReady();
        if (playbackIdRef.current !== playbackId) {
          return;
        }
        await playChord(node.root as Note, intervals, {
          durationSeconds: chordDurationSeconds,
          baseOctave,
          velocity,
          arpeggioIntervalMs,
          timingJitterPercent: arpeggioTimingJitterPercent,
        });
      } else {
        stopAllNotes();
      }

      if (playbackIdRef.current !== playbackId) {
        return;
      }
      sendMidiChord(node.root, intervals, {
        durationMs: chordDurationMs,
        baseOctave,
        velocity,
        arpeggioIntervalMs,
        timingJitterPercent: arpeggioTimingJitterPercent,
      });

      onChordTriggered?.({
        id: node.id,
        root: node.root,
        label: node.label,
        type: node.type,
      });

      setPlayingNode(node.id);
    } catch (error) {
      console.error('Failed to start chord playback:', error);
    }
  }, [
    arpeggioIntervalMs,
    arpeggioTimingJitterPercent,
    baseOctave,
    ensureInternalAudioReady,
    onChordTriggered,
    playChord,
    sendMidiChord,
    stopAllNotes,
    stopPlayback,
    sustainSeconds,
    useInternalAudio,
    velocity,
  ]);

  const handleNodeClick = useCallback(async (node: ChordNode) => {
    try {
      setHoveredNode(node.id);
      await startContinuousPlayback(node);
    } catch (error) {
      console.error('Failed to handle node click:', error);
    }
  }, [startContinuousPlayback]);

  useEffect(() => {
    const prev = controlValuesRef.current;
    const controlsChanged =
      prev.noteDurationSeconds !== noteDurationSeconds ||
      prev.baseOctave !== baseOctave ||
      prev.velocity !== velocity ||
      prev.arpeggioIntervalMs !== arpeggioIntervalMs ||
      prev.arpeggioTimingJitterPercent !== arpeggioTimingJitterPercent ||
      prev.useInternalAudio !== useInternalAudio;

    if (controlsChanged) {
      controlValuesRef.current = {
        noteDurationSeconds,
        baseOctave,
        velocity,
        arpeggioIntervalMs,
        arpeggioTimingJitterPercent,
        useInternalAudio,
      };

      if (playingNode) {
        stopPlayback();
      }
    }
  }, [
    noteDurationSeconds,
    baseOctave,
    velocity,
    arpeggioIntervalMs,
    arpeggioTimingJitterPercent,
    useInternalAudio,
    playingNode,
    stopPlayback,
  ]);

  useEffect(() => {
    if (!useInternalAudio) {
      stopAllNotes();
    }
  }, [stopAllNotes, useInternalAudio]);

  useEffect(() => stopPlayback, [stopPlayback]);

  const playChordById = useCallback(async (id: string) => {
    const node = nodeMap.get(id);
    if (!node) {
      console.warn(`No chord node found for id ${id}`);
      return;
    }
    await startContinuousPlayback(node);
  }, [nodeMap, startContinuousPlayback]);

  useImperativeHandle(ref, () => ({
    playChordById,
  }), [playChordById]);

return (
  <div className="flex h-full w-full flex-col bg-white text-gray-900">
    <div className="mx-4 mt-4 rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Controls</p>
        <button
          onClick={() => setIsPanelCollapsed(prev => !prev)}
          className="rounded-md px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50"
          >
            {isPanelCollapsed ? 'Show' : 'Hide'}
          </button>
        </div>
        {!isMidiSupported ? (
          <p className="mt-1 text-xs text-red-500">Web MIDI not supported in this browser.</p>
        ) : !hasMidiAccess ? (
          <button
            onClick={handleConnectMidi}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Connect MIDI
          </button>
        ) : (
          <>
            {midiOutputs.length === 0 ? (
              <p className="mt-1 text-xs text-gray-500">No MIDI outputs detected.</p>
            ) : (
              <select
                value={selectedOutputId ?? ''}
                onChange={event => selectMidiOutput(event.target.value || null)}
                className="mt-2 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="">None (mute MIDI)</option>
                {midiOutputs.map(output => (
                  <option key={output.id} value={output.id}>
                    {output.manufacturer ? `${output.manufacturer} — ${output.name}` : output.name}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        {midiError && (
          <p className="mt-1 text-xs text-red-500">{midiError}</p>
        )}
        {!isPanelCollapsed && (
          <div className="mt-3 space-y-3 border-t border-gray-200 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Playback</p>
            <label className="mt-2 flex items-center justify-between text-xs font-medium text-gray-600">
              <span>Internal Audio</span>
              <input
                type="checkbox"
                checked={useInternalAudio}
                onChange={handleInternalAudioToggle}
                className="h-4 w-4 accent-blue-600"
              />
            </label>
            {audioError && (
              <p className="text-xs text-red-500">{audioError}</p>
            )}
            <label className="mt-2 flex flex-col text-xs font-medium text-gray-600">
              Hold Duration (seconds)
              <input
                type="number"
                min={0.2}
                max={30}
                step={0.1}
                value={noteDurationSeconds}
                onChange={handleDurationChange}
                className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <input
              type="range"
              min={0.2}
              max={30}
              step={0.1}
              value={noteDurationSeconds}
              onChange={handleDurationChange}
              className="w-full"
            />
            <div className="text-xs text-gray-600">
              Hold: <span className="font-semibold text-gray-700">{displayHoldSeconds}s</span>
              <span className="ml-2">Interval: {(arpeggioIntervalMs / 1000).toFixed(2)}s</span>
            </div>
            <label className="mt-2 flex flex-col text-xs font-medium text-gray-600">
              Base Octave
              <select
                value={baseOctave}
                onChange={handleBaseOctaveChange}
                className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
              >
                {OCTAVE_OPTIONS.map(option => (
                  <option key={option} value={option}>{`C${option}`}</option>
                ))}
              </select>
            </label>
            <input
              type="range"
              min={Math.min(...OCTAVE_OPTIONS)}
              max={Math.max(...OCTAVE_OPTIONS)}
              step={1}
              value={baseOctave}
              onChange={handleBaseOctaveChange}
              className="w-full"
            />
            <label className="mt-2 flex flex-col text-xs font-medium text-gray-600">
              Velocity
              <input
                type="number"
                min={1}
                max={127}
                step={1}
                value={velocity}
                onChange={handleVelocityChange}
                className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <input
              type="range"
              min={1}
              max={127}
              step={1}
              value={velocity}
              onChange={handleVelocityChange}
              className="w-full"
            />
            <label className="mt-2 flex flex-col text-xs font-medium text-gray-600">
              Arpeggio Interval (ms)
              <input
                type="number"
                min={1}
                step={1}
                value={arpeggioIntervalMs}
                onChange={handleArpeggioIntervalChange}
                className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="mt-2 flex flex-col text-xs font-medium text-gray-600">
              Timing Variance (%)
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={arpeggioTimingJitterPercent}
                onChange={handleArpeggioJitterChange}
                className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={arpeggioTimingJitterPercent}
              onChange={handleArpeggioJitterChange}
              className="w-full"
            />
          </div>
        )}
      </div>

    <div className="flex-1 w-full overflow-auto px-4 pb-6 pt-2">
      <div className="w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700">Root</th>
                {CHORD_GROUPS.map(group => (
                  <th
                    key={group.title}
                    colSpan={group.columns.length}
                    className="sticky top-0 z-10 bg-slate-100 px-3 py-2 text-center font-semibold uppercase tracking-wide text-slate-600"
                  >
                    {group.title}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600">&nbsp;</th>
                {columnDefinitions.map(column => (
                  <th
                    key={`${column.groupIndex}-${column.key}-${column.columnIndex}`}
                    className="bg-slate-50 px-3 py-2 text-center font-semibold text-slate-600"
                  >
                    {column.display ?? column.suffix}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixRows.map(row => (
                <tr key={row.root} className="border-t border-slate-100">
                  <th className="sticky left-0 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 shadow-sm">
                    {row.root}
                  </th>
                  {row.cells.map(cell => {
                    const isHovered = hoveredNode === cell.id;
                    const isPlaying = playingNode === cell.id;
                    const baseClasses = 'w-full rounded-md border px-2 py-2 text-left font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500';
                    const visualClasses = isPlaying
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : isHovered
                        ? 'border-blue-300 bg-blue-50 text-blue-800'
                        : 'border-slate-200 bg-white text-slate-800 hover:border-blue-200 hover:bg-blue-50';

                    return (
                      <td key={cell.id} className="px-2 py-2">
                        <button
                          type="button"
                          className={`${baseClasses} ${visualClasses}`}
                          onClick={() => handleNodeClick(cell)}
                          onMouseEnter={() => setHoveredNode(cell.id)}
                          onMouseLeave={() => setHoveredNode(prev => (prev === cell.id ? null : prev))}
                        >
                          {cell.label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});

ChordDiagram.displayName = 'ChordDiagram';

export default ChordDiagram;
