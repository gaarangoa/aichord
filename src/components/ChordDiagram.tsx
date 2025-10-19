import { useEffect, useRef, useState, useCallback, useMemo, ChangeEvent } from 'react';
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
  x: number;
  y: number;
  type: ChordQuality;
  root: string;
  label: string;
  radius: number;
  angleOffset: number;
}

interface ChordEdge {
  from: string;
  to: string;
  type:
    | 'dominant'
    | 'relative'
    | 'parallel'
    | 'secondary'
    | 'substitute'
    | 'extension'
    | 'alteration'
    | 'diatonic'
    | 'leadingTone'
    | 'mixture'
    | 'neapolitan'
    | 'augmentedSixth'
    | 'chromaticMediant';
}

const NOTE_TO_SEMITONE: Record<string, number> = {
  'C': 0,
  'Db': 1,
  'D': 2,
  'Eb': 3,
  'E': 4,
  'F': 5,
  'F#': 6,
  'G': 7,
  'Ab': 8,
  'A': 9,
  'Bb': 10,
  'B': 11,
};

const SEMITONE_TO_NOTE: Record<number, string> = {
  0: 'C',
  1: 'Db',
  2: 'D',
  3: 'Eb',
  4: 'E',
  5: 'F',
  6: 'F#',
  7: 'G',
  8: 'Ab',
  9: 'A',
  10: 'Bb',
  11: 'B',
};

const transposeNote = (root: string, offset: number): string | undefined => {
  const base = NOTE_TO_SEMITONE[root];
  if (base === undefined) {
    return undefined;
  }
  const semitone = (base + offset + 12) % 12;
  return SEMITONE_TO_NOTE[semitone];
};

const OCTAVE_OPTIONS = [-1, 0, 1, 2, 3, 4, 5, 6] as const;
const NOTES = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'] as const;
const MINOR_NOTES = ['A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D'] as const;
const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
  'major': [0, 4, 7],
  'minor': [0, 3, 7],
  'dominant7': [0, 4, 7, 10],
  'major7': [0, 4, 7, 11],
  'minor7': [0, 3, 7, 10],
  'halfDiminished7': [0, 3, 6, 10],
  'diminished7': [0, 3, 6, 9],
  'dominant9': [0, 4, 7, 10, 14],
  'major9': [0, 4, 7, 11, 14],
  'minor9': [0, 3, 7, 10, 14],
  'dominant11': [0, 4, 7, 10, 14, 17],
  'major11': [0, 4, 7, 11, 14, 17],
  'minor11': [0, 3, 7, 10, 14, 17],
  'dominant13': [0, 4, 7, 10, 14, 17, 21],
  'major13': [0, 4, 7, 11, 14, 17, 21],
  'minor13': [0, 3, 7, 10, 14, 17, 21],
  'augmented': [0, 4, 8],
  'diminished': [0, 3, 6],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  'add9': [0, 4, 7, 14],
  'add11': [0, 4, 7, 17],
};

const ChordDiagram: React.FC = () => {
  // Refs and state
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 800 });
  const { initialize, startContext, stopAllNotes, playChord } = usePianoSynthesizer();
  const [isSynthInitialized, setIsSynthInitialized] = useState(false);
  const [playingNode, setPlayingNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [noteDurationSeconds, setNoteDurationSeconds] = useState<number>(4);
  const [baseOctave, setBaseOctave] = useState<number>(1);
  const [velocity, setVelocity] = useState<number>(96);
  const [arpeggioIntervalMs, setArpeggioIntervalMs] = useState<number>(120);
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

  const sustainSeconds = useMemo(() => {
    return Math.max(0.2, noteDurationSeconds);
  }, [noteDurationSeconds]);

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
    if (Number.isNaN(next)) {
      return;
    }
    const normalized = Math.max(1, next);
    setArpeggioIntervalMs(normalized);
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
    const enabled = event.target.checked;
    setUseInternalAudio(enabled);
    if (!enabled) {
      stopAllNotes();
      setAudioError(null);
    }
  }, [stopAllNotes]);

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

  // Function to stop playback
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

  const handleBackgroundClick = () => {
    stopPlayback();
    setHoveredNode(null);
  };

  // Function to start continuous playback
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

      console.log(`Triggering MIDI chord ${node.type} with root ${node.root}`);
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

      setPlayingNode(node.id);
    } catch (error) {
      console.error('Failed to start chord playback:', error);
    }
  }, [
    arpeggioIntervalMs,
    arpeggioTimingJitterPercent,
    baseOctave,
    ensureInternalAudioReady,
    playChord,
    sendMidiChord,
    sustainSeconds,
    useInternalAudio,
    velocity,
    stopAllNotes,
    stopPlayback,
  ]);

  // Handle node click
  const handleNodeClick = useCallback(async (node: ChordNode) => {
    try {
      setHoveredNode(node.id);

      await startContinuousPlayback(node);
    } catch (error) {
      console.error('Failed to handle node click:', error);
    }
  }, [startContinuousPlayback]);

  // Effect to handle resizing
  useEffect(() => {
    const handleResize = () => {
      if (svgRef.current) {
        const { width, height } = svgRef.current.getBoundingClientRect();
        setDimensions({ width, height });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial call to set dimensions

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

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

  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, [stopPlayback]);

  // Calculate nodes with memoization
  const nodes = useMemo(() => {
    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const nodesList: ChordNode[] = [];

    // Define chord types and their configurations
    const chordConfigs = [
      // Basic triads
      { type: 'major', suffix: 'maj', radius: dimensions.width * 0.15, angleOffset: 0 }, // inner ring for major triads
      { type: 'minor', suffix: 'min', radius: dimensions.width * 0.20, angleOffset: Math.PI / 12 }, // adjacent ring for minor triads
      
      // Seventh chords
      { type: 'dominant7', suffix: '7', radius: dimensions.width * 0.25, angleOffset: 0 },
      { type: 'major7', suffix: 'maj7', radius: dimensions.width * 0.25, angleOffset: Math.PI / 12 },
      { type: 'minor7', suffix: 'm7', radius: dimensions.width * 0.25, angleOffset: Math.PI / 6 },
      { type: 'halfDiminished7', suffix: 'ø7', radius: dimensions.width * 0.25, angleOffset: Math.PI / 4 },
      { type: 'diminished7', suffix: '°7', radius: dimensions.width * 0.25, angleOffset: Math.PI / 3 },
      
      // Extended chords
      { type: 'dominant9', suffix: '9', radius: dimensions.width * 0.35, angleOffset: 0 },
      { type: 'major9', suffix: 'maj9', radius: dimensions.width * 0.35, angleOffset: Math.PI / 12 },
      { type: 'minor9', suffix: 'm9', radius: dimensions.width * 0.35, angleOffset: Math.PI / 6 },
      
      { type: 'dominant11', suffix: '11', radius: dimensions.width * 0.35, angleOffset: Math.PI / 4 },
      { type: 'major11', suffix: 'maj11', radius: dimensions.width * 0.35, angleOffset: Math.PI / 3 },
      { type: 'minor11', suffix: 'm11', radius: dimensions.width * 0.35, angleOffset: Math.PI / 2.4 },
      
      // Altered and suspended chords (outer circle)
      { type: 'augmented', suffix: 'aug', radius: dimensions.width * 0.45, angleOffset: 0 },
      { type: 'diminished', suffix: 'dim', radius: dimensions.width * 0.45, angleOffset: Math.PI / 12 },
      { type: 'sus2', suffix: 'sus2', radius: dimensions.width * 0.45, angleOffset: Math.PI / 6 },
      { type: 'sus4', suffix: 'sus4', radius: dimensions.width * 0.45, angleOffset: Math.PI / 4 },
      { type: 'add9', suffix: 'add9', radius: dimensions.width * 0.45, angleOffset: Math.PI / 3 },
      { type: 'add11', suffix: 'add11', radius: dimensions.width * 0.45, angleOffset: Math.PI / 2.4 },
    ];

    // Create nodes for each chord type and root note
    NOTES.forEach((note, i) => {
      const baseAngle = (2 * Math.PI * i) / 12 - Math.PI / 2; // Start from top (C)
      
      chordConfigs.forEach(config => {
        const angle = baseAngle + config.angleOffset;
        nodesList.push({
          id: note + config.suffix,
          x: centerX + config.radius * Math.cos(angle),
          y: centerY + config.radius * Math.sin(angle),
          type: config.type as ChordQuality,
          root: note,
          label: `${note}${config.suffix}`,
          radius: config.radius,
          angleOffset: config.angleOffset
        });
      });
    });

    return nodesList;
  }, [dimensions]);

  // Calculate edges with memoization
  const edges = useMemo(() => {
    const edgesList: ChordEdge[] = [];
    const addedEdges = new Set<string>();

    const nodeMap = new Map<string, string>();
    nodes.forEach(n => nodeMap.set(`${n.root}:${n.type}`, n.id));

    const findChordId = (root: string, type: ChordQuality) => nodeMap.get(`${root}:${type}`);
    const extensionChains: ChordQuality[][] = [
      ['major', 'major7', 'major9', 'major11', 'major13'],
      ['minor', 'minor7', 'minor9', 'minor11', 'minor13'],
      ['dominant7', 'dominant9', 'dominant11', 'dominant13'],
    ];
    const mixtureTargetsMajor: Array<{ interval: number; quality: ChordQuality }> = [
      { interval: 3, quality: 'major' },  // ♭III
      { interval: 5, quality: 'minor' },  // iv
      { interval: 8, quality: 'major' },  // ♭VI
      { interval: 10, quality: 'major' }, // ♭VII
    ];
    const mixtureTargetsMinor: Array<{ interval: number; quality: ChordQuality }> = [
      { interval: 0, quality: 'major' },  // Picardy (I)
      { interval: 5, quality: 'major' },  // IV
      { interval: 7, quality: 'major' },  // V
    ];
    const secondaryTargetsMajor: Array<{ interval: number; quality: ChordQuality }> = [
      { interval: 2, quality: 'minor' },  // ii
      { interval: 4, quality: 'minor' },  // iii
      { interval: 5, quality: 'major' },  // IV
      { interval: 7, quality: 'major' },  // V
      { interval: 9, quality: 'minor' },  // vi
    ];
    const secondaryTargetsMinor: Array<{ interval: number; quality: ChordQuality }> = [
      { interval: 3, quality: 'major' },  // III
      { interval: 5, quality: 'minor' },  // iv
      { interval: 7, quality: 'major' },  // V
      { interval: 8, quality: 'major' },  // VI
      { interval: 10, quality: 'major' }, // VII
    ];
    const chromaticMediantIntervals = [4, -4, 8, -8];

    // Helper function to safely add an edge if it doesn't exist
    const addEdge = (from: string | undefined, to: string | undefined, type: ChordEdge['type']) => {
      if (from && to) {
        const edgeKey = `${from}-${to}-${type}`;
        if (!addedEdges.has(edgeKey)) {
          edgesList.push({ from, to, type });
          addedEdges.add(edgeKey);
        }
      }
    };

    // Process each note
    NOTES.forEach((note, i) => {
      const dominantRoot = NOTES[(i + 1) % 12]; // Perfect fifth above tonic
      const dominantIndex = (i + 1) % 12;
      const tritoneOfDominant = NOTES[(dominantIndex + 6) % 12]; // Tritone substitute for dominant
      const relativeMinorRoot = MINOR_NOTES[i]; // Relative minor shares key signature
      const leadingRoot = transposeNote(note, -1);
      const neapolitanRoot = transposeNote(note, 1);
      const flatSixRoot = transposeNote(note, -4);

      const tonicMajor = findChordId(note, 'major');
      const tonicMinor = findChordId(note, 'minor');
      const dominantMajor = findChordId(dominantRoot, 'major');
      const dominantSeven = findChordId(dominantRoot, 'dominant7');
      const tritoneDominant = findChordId(tritoneOfDominant, 'dominant7');
      const relativeMinor = findChordId(relativeMinorRoot, 'minor');
      const dominantTarget = dominantSeven ?? dominantMajor;

      // Functional dominant motion (V -> I and V7 -> I / i)
      addEdge(dominantMajor, tonicMajor, 'dominant');
      addEdge(dominantSeven, tonicMajor, 'dominant');
      addEdge(dominantMajor, tonicMinor, 'dominant');
      addEdge(dominantSeven, tonicMinor, 'dominant');

      // Tritone substitution resolves to tonic
      addEdge(tritoneDominant, tonicMajor, 'substitute');
      addEdge(tritoneDominant, tonicMinor, 'substitute');

      // Relative relationships (major <-> relative minor)
      addEdge(tonicMajor, relativeMinor, 'relative');
      addEdge(relativeMinor, tonicMajor, 'relative');

      // Parallel relationships (same root major/minor)
      addEdge(tonicMajor, tonicMinor, 'parallel');
      addEdge(tonicMinor, tonicMajor, 'parallel');

      // Leading-tone resolutions (fully and half diminished)
      if (leadingRoot) {
        const leadingDim = findChordId(leadingRoot, 'diminished7');
        addEdge(leadingDim, tonicMajor, 'leadingTone');
        addEdge(leadingDim, tonicMinor, 'leadingTone');

        const leadingHalfDim = findChordId(leadingRoot, 'halfDiminished7');
        addEdge(leadingHalfDim, tonicMinor, 'leadingTone');
      }

      // Secondary dominants (all diatonic scale degrees)
      const addSecondaryDominants = (targets: Array<{ interval: number; quality: ChordQuality }>) => {
        targets.forEach(({ interval, quality }) => {
          const targetRoot = transposeNote(note, interval);
          if (!targetRoot) return;
          const targetChord = findChordId(targetRoot, quality);
          if (!targetChord) return;

          const appliedRoot = transposeNote(targetRoot, 7);
          if (!appliedRoot) return;

          const appliedDominant7 = findChordId(appliedRoot, 'dominant7');
          const appliedDominantMajor = findChordId(appliedRoot, 'major');

          addEdge(appliedDominant7, targetChord, 'secondary');
          addEdge(appliedDominantMajor, targetChord, 'secondary');
        });
      };

      if (tonicMajor) {
        addSecondaryDominants(secondaryTargetsMajor);
      }
      if (tonicMinor) {
        addSecondaryDominants(secondaryTargetsMinor);
      }

      // Neapolitan and augmented-sixth approaches to the dominant
      if (neapolitanRoot) {
        const neapolitanChord = findChordId(neapolitanRoot, 'major');
        addEdge(neapolitanChord, dominantTarget, 'neapolitan');
      }

      if (flatSixRoot) {
        const flatSixDominant = findChordId(flatSixRoot, 'dominant7');
        addEdge(flatSixDominant, dominantTarget, 'augmentedSixth');
      }

      // Modal mixture
      if (tonicMajor) {
        mixtureTargetsMajor.forEach(({ interval, quality }) => {
          const targetRoot = transposeNote(note, interval);
          if (!targetRoot) return;
          addEdge(tonicMajor, findChordId(targetRoot, quality), 'mixture');
        });
      }

      if (tonicMinor) {
        mixtureTargetsMinor.forEach(({ interval, quality }) => {
          const targetRoot = transposeNote(note, interval);
          if (!targetRoot) return;
          addEdge(tonicMinor, findChordId(targetRoot, quality), 'mixture');
        });
      }

      // Chromatic mediants from the tonic center
      const chromaticSourceIds = [tonicMajor, tonicMinor];
      chromaticSourceIds.forEach(sourceId => {
        if (!sourceId) return;
        chromaticMediantIntervals.forEach(interval => {
          const targetRoot = transposeNote(note, interval);
          if (!targetRoot) return;
          ['major', 'minor'].forEach((quality) => {
            addEdge(
              sourceId,
              findChordId(targetRoot, quality as ChordQuality),
              'chromaticMediant'
            );
          });
        });
      });

      // Diatonic motion from the tonic
      if (tonicMajor) {
        const diatonicMajorTargets: Array<{ interval: number; quality: ChordQuality }> = [
          { interval: 5, quality: 'major' }, // IV
          { interval: 7, quality: 'major' }, // V
          { interval: 2, quality: 'minor' }, // ii
          { interval: 4, quality: 'minor' }, // iii
          { interval: 9, quality: 'minor' }, // vi
        ];

        diatonicMajorTargets.forEach(({ interval, quality }) => {
          const targetRoot = transposeNote(note, interval);
          if (!targetRoot) return;
          addEdge(
            tonicMajor,
            findChordId(targetRoot, quality),
            'diatonic'
          );
        });
      }

      if (tonicMinor) {
        const diatonicMinorTargets: Array<{ interval: number; quality: ChordQuality }> = [
          { interval: 5, quality: 'minor' }, // iv
          { interval: 7, quality: 'minor' }, // v
          { interval: 7, quality: 'dominant7' }, // V7 (harmonic minor)
          { interval: 8, quality: 'major' }, // VI
          { interval: 10, quality: 'major' }, // VII (subtonic)
        ];

        diatonicMinorTargets.forEach(({ interval, quality }) => {
          const targetRoot = transposeNote(note, interval);
          if (!targetRoot) return;
          addEdge(
            tonicMinor,
            findChordId(targetRoot, quality),
            'diatonic'
          );
        });
      }

      // Suspended chord resolutions
      ['sus2', 'sus4'].forEach(susType => {
        const suspendedChord = findChordId(note, susType as ChordQuality);
        addEdge(suspendedChord, tonicMajor, 'alteration');

        const dominantForSuspension = transposeNote(note, 7);
        if (dominantForSuspension) {
          addEdge(
            suspendedChord,
            findChordId(dominantForSuspension, 'diminished7'),
            'alteration'
          );
        }
      });

      // Altered triads connecting back to diatonic quality
      addEdge(findChordId(note, 'augmented'), tonicMajor, 'alteration');
      addEdge(findChordId(note, 'diminished'), tonicMinor, 'alteration');

      // Extension relationships (layered color)
      extensionChains.forEach(chain => {
        for (let j = 0; j < chain.length - 1; j += 1) {
          const fromId = findChordId(note, chain[j]);
          const toId = findChordId(note, chain[j + 1]);
          addEdge(fromId, toId, 'extension');
        }
      });

      // Added tone resolutions
      const addNine = findChordId(note, 'add9');
      const addEleven = findChordId(note, 'add11');
      addEdge(addNine, findChordId(note, 'major'), 'extension');
      addEdge(addEleven, findChordId(note, 'major7'), 'extension');
    });

    return edgesList;
  }, [nodes]);

  const connectedToHover = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const related = new Set<string>();
    edges.forEach(edge => {
      if (edge.from === hoveredNode) {
        related.add(edge.to);
      }
      if (edge.to === hoveredNode) {
        related.add(edge.from);
      }
    });
    return related;
  }, [edges, hoveredNode]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-white text-gray-900 relative">
      <div className="absolute top-4 left-4 z-40 min-w-[240px] rounded-lg bg-white/90 px-3 py-3 shadow space-y-3">
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
                onChange={(event) => selectMidiOutput(event.target.value || null)}
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
          <div className="space-y-3 border-t border-gray-200 pt-3">
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
      <svg
        ref={svgRef}
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="w-full h-full"
        onClick={handleBackgroundClick}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L10,3.5 L0,7 Z" fill="#9ca3af" />
          </marker>
        </defs>

        {/* Draw edges */}
        <g className="edges">
          {edges.map((edge: ChordEdge, i: number) => {
            const fromNode = nodes.find(n => n.id === edge.from)!;
            const toNode = nodes.find(n => n.id === edge.to)!;
            const isEdgeActive = hoveredNode && (edge.from === hoveredNode || edge.to === hoveredNode);

            return (
              <path
                key={`${edge.from}-${edge.to}-${edge.type}-${i}`}
                d={`M ${fromNode.x} ${fromNode.y} L ${toNode.x} ${toNode.y}`}
                stroke={isEdgeActive ? '#6b7280' : '#d1d5db'}
                strokeWidth={isEdgeActive ? "2.5" : "1.5"}
                fill="none"
                opacity={isEdgeActive ? 0.9 : 0.45}
                strokeDasharray={(() => {
                  switch (edge.type) {
                    case 'substitute': return "5,5";
                    case 'extension': return "3,3";
                    case 'alteration': return "7,3";
                    case 'secondary': return "9,3";
                    case 'diatonic': return "12,4";
                    case 'leadingTone': return "2,6";
                    case 'mixture': return "10,6";
                    case 'neapolitan': return "4,8";
                    case 'augmentedSixth': return "6,6";
                    case 'chromaticMediant': return "14,4";
                    default: return "none";
                  }
                })()}
                markerEnd="url(#arrowhead)"
              />
            );
          })}
        </g>

        {/* Draw nodes */}
        <g className="nodes">
          {nodes.map((node: ChordNode) => (
            <g
              key={node.id}
              transform={`translate(${node.x},${node.y})`}
              onClick={(e) => {
                e.stopPropagation();
                handleNodeClick(node);
              }}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(prev => (prev === node.id ? null : prev))}
              style={{ cursor: 'pointer' }}
            >
              {(() => {
                const isHovered = node.id === hoveredNode;
                const isPlaying = node.id === playingNode;
                const isReachable = hoveredNode !== null && connectedToHover.has(node.id);
                const fillColor = isPlaying
                  ? '#4CAF50'
                  : isHovered
                    ? '#2563eb'
                    : isReachable
                      ? '#fef3c7'
                      : '#ffffff';
                const strokeColor = isPlaying
                  ? '#166534'
                  : isHovered
                    ? '#1d4ed8'
                    : isReachable
                      ? '#facc15'
                      : '#ffffff';
                const strokeWidth = isHovered ? "2.5" : isReachable ? "2" : isPlaying ? "2.25" : "0";
                const showStroke = isHovered || isPlaying || isReachable;
                const textColor = (isHovered || isPlaying) ? '#ffffff' : '#1f2937';

                return (
                  <>
                    <circle
                      r={15}
                      fill={fillColor}
                      stroke={showStroke ? strokeColor : 'none'}
                      strokeWidth={showStroke ? strokeWidth : 0}
                    />
                    <text
                      textAnchor="middle"
                      dy=".3em"
                      fontSize="12"
                      fill={textColor}
                    >
                      {node.label}
                    </text>
                  </>
                );
              })()}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
};

export default ChordDiagram;
