import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { usePianoSynthesizer, type Note } from '@/lib/piano';

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
  radius: number;
  angleOffset: number;
}

interface ChordEdge {
  from: string;
  to: string;
  type: 'dominant' | 'relative' | 'parallel' | 'secondary' | 'substitute' | 'extension' | 'alteration';
}

const ChordDiagram: React.FC = () => {
  // Refs and state
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 800 });
  const { initialize, startContext, stopAllNotes, playChord } = usePianoSynthesizer();
  const [isInitialized, setIsInitialized] = useState(false);
  const [showLoading, setShowLoading] = useState(false); // No samples to load
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [playingNode, setPlayingNode] = useState<string | null>(null);
  const [playbackInterval, setPlaybackInterval] = useState<number | null>(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);

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
  const minorNotes = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'Bb', 'F', 'C', 'G', 'D'] as const;

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
    stopAllNotes(); // Stop any currently playing notes
  }, [playbackInterval, stopAllNotes]);

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
    setSelectedNode(null);
    stopPlayback();
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

      console.log(`Playing ${node.type} string chord with root ${node.root}`);
      await playChord(node.root as Note, intervals);

      // Set up continuous playback
      const interval = window.setInterval(async () => {
        try {
          await playChord(node.root as Note, intervals);
        } catch (error) {
          console.error('Failed to play chord in interval:', error);
        }
      }, 4000); // Longer interval for sustained string sound

      setPlaybackInterval(interval);
      setPlayingNode(node.id);
    } catch (error) {
      console.error('Failed to start chord playback:', error);
    }
  }, [isInitialized, initializePiano, playChord]);

  // Handle node click
  const handleNodeClick = useCallback(async (node: ChordNode) => {
    try {
      setSelectedNode(prev => prev === node.id ? null : node.id);
      
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

  // Calculate nodes with memoization
  const nodes = useMemo(() => {
    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const nodesList: ChordNode[] = [];

    // Define chord types and their configurations
    const chordConfigs = [
      // Basic triads (innermost circle)
      { type: 'major', suffix: 'maj', radius: dimensions.width * 0.15, angleOffset: 0 },
      { type: 'minor', suffix: 'min', radius: dimensions.width * 0.15, angleOffset: Math.PI / 12 },
      
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
      const nextNote = notes[(i + 1) % 12]; // Perfect fifth up
      const tritoneNote = notes[(i + 6) % 12]; // Tritone
      const relativeMinorNote = minorNotes[(i + 9) % 12]; // Relative minor

      // Find the node IDs for various chord types
      const findChordId = (root: string, type: ChordQuality) => 
        nodes.find((n: ChordNode) => n.root === root && n.type === type)?.id;

      // Basic dominant relationships
      addEdge(findChordId(note, 'major'), findChordId(nextNote, 'major'), 'dominant');
      addEdge(findChordId(note, 'dominant7'), findChordId(nextNote, 'major'), 'dominant');

      // Extension relationships
      ['major', 'minor', 'dominant7'].forEach(baseType => {
        ['9', '11', '13'].forEach(ext => {
          addEdge(
            findChordId(note, baseType as ChordQuality),
            findChordId(note, `${baseType}${ext}` as ChordQuality),
            'extension'
          );
        });
      });

      // Relative major/minor relationships
      addEdge(findChordId(note, 'major'), findChordId(relativeMinorNote, 'minor'), 'relative');

      // Parallel relationships
      ['major', 'minor', 'augmented', 'diminished'].forEach(type1 => {
        ['major', 'minor', 'augmented', 'diminished'].forEach(type2 => {
          if (type1 !== type2) {
            addEdge(
              findChordId(note, type1 as ChordQuality),
              findChordId(note, type2 as ChordQuality),
              'parallel'
            );
          }
        });
      });

      // Secondary dominants
      addEdge(findChordId(note, 'dominant7'), findChordId(nextNote, 'major'), 'secondary');

      // Tritone substitutions
      addEdge(findChordId(tritoneNote, 'dominant7'), findChordId(note, 'major'), 'substitute');

      // Suspended chord resolutions
      ['sus2', 'sus4'].forEach(susType => {
        addEdge(
          findChordId(note, susType as ChordQuality),
          findChordId(note, 'major'),
          'alteration'
        );
      });
    });

    return edgesList;
  }, [nodes, notes, minorNotes]);

  // Helper function to check if a node is connected to the selected node
  const isConnected = useCallback((nodeId: string) => {
    if (!selectedNode) return false;
    return edges.some(
      (edge: ChordEdge) => (edge.from === selectedNode && edge.to === nodeId) ||
              (edge.to === selectedNode && edge.from === nodeId)
    );
  }, [selectedNode, edges]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 text-white relative">
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
            <path d="M0,0 L10,3.5 L0,7 Z" fill="#888" />
          </marker>
        </defs>

        {/* Draw edges */}
        <g className="edges">
          {edges.map((edge: ChordEdge, i: number) => {
            const fromNode = nodes.find(n => n.id === edge.from)!;
            const toNode = nodes.find(n => n.id === edge.to)!;
            return (
              <path
                key={`${edge.from}-${edge.to}-${edge.type}-${i}`}
                d={`M ${fromNode.x} ${fromNode.y} L ${toNode.x} ${toNode.y}`}
                stroke={(() => {
                  if (isConnected(edge.to)) return '#333';
                  switch (edge.type) {
                    case 'dominant': return '#4A90E2';     // Blue for dominant relationships
                    case 'relative': return '#50C878';     // Green for relative major/minor
                    case 'parallel': return '#FFD700';     // Gold for parallel major/minor
                    case 'secondary': return '#FF69B4';    // Pink for secondary dominants
                    case 'substitute': return '#9370DB';   // Purple for substitutes
                    case 'extension': return '#FFA500';    // Orange for extensions
                    case 'alteration': return '#20B2AA';   // Light sea green for alterations
                    default: return '#888';
                  }
                })()}
                strokeWidth={(() => {
                  if (isConnected(edge.to)) return "2.5";
                  switch (edge.type) {
                    case 'extension': return "2";
                    case 'alteration': return "2";
                    default: return "1.5";
                  }
                })()}
                fill="none"
                opacity={(() => {
                  if (isConnected(edge.to)) return 0.9;
                  switch (edge.type) {
                    case 'extension': return 0.7;
                    case 'alteration': return 0.7;
                    default: return 0.6;
                  }
                })()}
                strokeDasharray={(() => {
                  switch (edge.type) {
                    case 'substitute': return "5,5";
                    case 'extension': return "3,3";
                    case 'alteration': return "7,3";
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
              style={{ cursor: 'pointer' }}
            >
              <circle
                r={15}
                fill={node.id === playingNode ? '#4CAF50' : 
                      node.id === selectedNode ? '#2196F3' : 
                      isConnected(node.id) ? '#90CAF9' : '#fff'}
                stroke={node.id === selectedNode ? '#1565C0' : '#666'}
                strokeWidth={node.id === selectedNode ? "2.5" : "1.5"}
              />
              <text
                textAnchor="middle"
                dy=".3em"
                fontSize="12"
                fill={node.id === selectedNode ? '#fff' : '#333'}
              >
                {node.root}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
};

export default ChordDiagram;