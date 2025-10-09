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

const NOTE_VALUE_OPTIONS = [
  { id: 'whole', label: 'Whole note (white)', beats: 4, color: 'white' as const },
  { id: 'half', label: 'Half note (white)', beats: 2, color: 'white' as const },
  { id: 'quarter', label: 'Quarter note (black)', beats: 1, color: 'black' as const },
  { id: 'eighth', label: 'Eighth note (black)', beats: 0.5, color: 'black' as const },
] as const;

type NoteValueId = typeof NOTE_VALUE_OPTIONS[number]['id'];
type NoteHeadColor = typeof NOTE_VALUE_OPTIONS[number]['color'];

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

const ChordDiagram: React.FC = () => {
  // Refs and state
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 800 });
  const { initialize, startContext, stopAllNotes, playChord } = usePianoSynthesizer();
  const [isInitialized, setIsInitialized] = useState(false);
  const [showLoading, setShowLoading] = useState(false); // No samples to load
  const [playingNode, setPlayingNode] = useState<string | null>(null);
  const [playbackInterval, setPlaybackInterval] = useState<number | null>(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [noteValueId, setNoteValueId] = useState<NoteValueId>('whole');
  const [tempo, setTempo] = useState<number>(60);
  const [durationMultiplier, setDurationMultiplier] = useState<number>(1.2);
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

  const currentNoteValue = useMemo(() => {
    return NOTE_VALUE_OPTIONS.find(option => option.id === noteValueId) ?? NOTE_VALUE_OPTIONS[0];
  }, [noteValueId]);

  const baseDurationSeconds = useMemo(() => {
    const beats = currentNoteValue?.beats ?? 1;
    const bpm = Math.max(20, tempo);
    return (60 / bpm) * beats;
  }, [currentNoteValue, tempo]);

  const sustainSeconds = useMemo(() => {
    return Math.max(0.2, baseDurationSeconds * durationMultiplier);
  }, [baseDurationSeconds, durationMultiplier]);

  const loopIntervalMs = useMemo(() => {
    return Math.max(300, sustainSeconds * 1000 + 250);
  }, [sustainSeconds]);

  const noteHeadLabel: string = useMemo(() => {
    const color: NoteHeadColor = currentNoteValue?.color ?? 'white';
    return color === 'white' ? 'White (open notehead)' : 'Black (filled notehead)';
  }, [currentNoteValue]);

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

  const handleTempoChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (Number.isNaN(next)) {
      return;
    }
    const clamped = Math.max(20, Math.min(240, next));
    setTempo(clamped);
  }, []);

  const handleNoteValueChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setNoteValueId(event.target.value as NoteValueId);
  }, []);

  const handleDurationMultiplierChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (Number.isNaN(next)) {
      return;
    }
    const clamped = Math.max(0.5, Math.min(4, next));
    setDurationMultiplier(clamped);
  }, []);

  const chordIntervals: Record<ChordQuality, number[]> = {
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

  // Constants
  const notes = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'] as const;
  const minorNotes = ['A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D'] as const;

  // Function to initialize piano
  const initializePiano = useCallback(async () => {
    if (!isInitialized) {
      setShowLoading(true);
      try {
        // This will be a no-op until we have user interaction
        await initialize();
        console.log('Piano initialization prepared');
        setIsInitialized(true);
        setShowLoading(false);
      } catch (error) {
        console.error('Failed to initialize piano:', error);
      } finally {
        setShowLoading(false);
      }
    }
  }, [initialize, isInitialized]);

  // Function to stop playback
  const stopPlayback = useCallback(() => {
    if (playbackInterval) {
      window.clearInterval(playbackInterval);
      setPlaybackInterval(null);
    }
    setPlayingNode(null);
    stopMidiOutput();
    stopAllNotes(); // Stop any currently playing notes
  }, [playbackInterval, stopMidiOutput, stopAllNotes]);

  const handleEnableAudio = async () => {
    try {
      await startContext();
      setIsAudioEnabled(true);
      console.log('Audio enabled and context started.');
    } catch (error) {
      console.error('Failed to enable audio:', error);
    }
  };

  const handleBackgroundClick = () => {
    stopPlayback();
    setHoveredNode(null);
  };

  // Function to start continuous playback
  const startContinuousPlayback = useCallback(async (node: ChordNode) => {
    try {
      // Ensure initialization on first interaction
      if (!isInitialized) {
        await initializePiano();
      }

      const intervals = chordIntervals[node.type];
      if (!intervals) {
        console.warn(`No intervals defined for chord type: ${node.type}`);
        return;
      }

      const chordDurationSeconds = sustainSeconds;
      const chordDurationMs = chordDurationSeconds * 1000;
      const cycleDelay = loopIntervalMs;

      console.log(`Playing ${node.type} string chord with root ${node.root}`);
      await playChord(node.root as Note, intervals, chordDurationSeconds);
      sendMidiChord(node.root, intervals, chordDurationMs);

      // Set up continuous playback
      const interval = window.setInterval(async () => {
        try {
          await playChord(node.root as Note, intervals, chordDurationSeconds);
          sendMidiChord(node.root, intervals, chordDurationMs);
        } catch (error) {
          console.error('Failed to play chord in interval:', error);
        }
      }, cycleDelay); // Interval derived from tempo and note length

      setPlaybackInterval(interval);
      setPlayingNode(node.id);
    } catch (error) {
      console.error('Failed to start chord playback:', error);
    }
  }, [isInitialized, initializePiano, playChord, sendMidiChord, sustainSeconds, loopIntervalMs]);

  // Handle node click
  const handleNodeClick = useCallback(async (node: ChordNode) => {
    try {
      setHoveredNode(node.id);

      // If clicking the same node that's playing, stop playback
      if (playingNode === node.id) {
        stopPlayback();
      } else {
        // Stop any previous playback before starting a new one
        stopPlayback();

        // Ensure audio context is started on first interaction
        if (!isAudioEnabled) {
          console.warn('Audio not enabled. Please click "Enable Sound" first.');
          return;
        }
        
        // Start playing the new node
        await startContinuousPlayback(node);
      }
    } catch (error) {
      console.error('Failed to handle node click:', error);
    }
  }, [playingNode, startContinuousPlayback, stopPlayback, isAudioEnabled]);

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

  // Initialize audio context on first interaction
  useEffect(() => {
    const handleFirstInteraction = async () => {
      await initializePiano();
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };

    document.addEventListener('click', handleFirstInteraction);
    document.addEventListener('touchstart', handleFirstInteraction);
    document.addEventListener('keydown', handleFirstInteraction);

    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [initializePiano]);

  useEffect(() => {
    if (playingNode) {
      stopPlayback();
    }
  }, [tempo, noteValueId, durationMultiplier, playingNode, stopPlayback]);

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
    notes.forEach((note, i) => {
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
  }, [dimensions, notes]);

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
    notes.forEach((note, i) => {
      const dominantRoot = notes[(i + 1) % 12]; // Perfect fifth above tonic
      const dominantIndex = (i + 1) % 12;
      const tritoneOfDominant = notes[(dominantIndex + 6) % 12]; // Tritone substitute for dominant
      const relativeMinorRoot = minorNotes[i]; // Relative minor shares key signature
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
  }, [nodes, notes, minorNotes]);

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
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">MIDI Output</p>
        {!isMidiSupported ? (
          <p className="mt-1 text-xs text-red-500">Web MIDI not supported in this browser.</p>
        ) : !hasMidiAccess ? (
          <button
            onClick={handleConnectMidi}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Connect MIDI
          </button>
        ) : midiOutputs.length === 0 ? (
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
        {midiError && (
          <p className="mt-1 text-xs text-red-500">{midiError}</p>
        )}
        <div className="border-t border-gray-200 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Playback</p>
          <label className="mt-2 flex flex-col text-xs font-medium text-gray-600">
            Tempo (BPM)
            <input
              type="number"
              min={20}
              max={240}
              step={1}
              value={tempo}
              onChange={handleTempoChange}
              className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="mt-2 flex flex-col text-xs font-medium text-gray-600">
            Note Value
            <select
              value={noteValueId}
              onChange={handleNoteValueChange}
              className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
            >
              {NOTE_VALUE_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 flex flex-col text-xs font-medium text-gray-600">
            Sustain Multiplier
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.1}
              value={durationMultiplier}
              onChange={handleDurationMultiplierChange}
              className="mt-1"
            />
          </label>
          <div className="mt-2 text-xs text-gray-600">
            Hold: <span className="font-semibold text-gray-700">{displayHoldSeconds}s</span>
            <span className="ml-1 text-gray-500">({durationMultiplier.toFixed(1)}×)</span>
            <span className="ml-2">Note head: {noteHeadLabel}</span>
            <span className="ml-2">Loop: {(loopIntervalMs / 1000).toFixed(2)}s</span>
          </div>
        </div>
      </div>
      {!isAudioEnabled && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <button
            onClick={handleEnableAudio}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg text-xl font-bold hover:bg-blue-700 transition-colors"
          >
            Enable Sound
          </button>
        </div>
      )}
      {showLoading && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
          <p>Loading audio samples...</p>
        </div>
      )}
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
