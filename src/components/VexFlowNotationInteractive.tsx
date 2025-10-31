'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Beam } from 'vexflow';

type NoteDuration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' |
                     'dotted-half' | 'dotted-quarter' | 'dotted-eighth';

interface VexNote {
  notes: string[]; // e.g., ['C/4', 'E/4', 'G/4']
  duration: NoteDuration;
  beat: number;
  chordLabel?: string;
  id?: string; // Unique identifier
}

interface VexFlowNotationInteractiveProps {
  notes: VexNote[];
  onNotesChange?: (notes: VexNote[]) => void;
  onRenderComplete?: () => void;
}

interface SelectedNote {
  noteIndex: number;
  noteInChordIndex: number; // For chords with multiple notes
}

export default function VexFlowNotationInteractive({
  notes,
  onNotesChange,
  onRenderComplete
}: VexFlowNotationInteractiveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedNote, setSelectedNote] = useState<SelectedNote | null>(null);
  const [hoveredNote, setHoveredNote] = useState<SelectedNote | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  // Duration options for cycling
  const durations: NoteDuration[] = ['whole', 'half', 'dotted-half', 'quarter', 'dotted-quarter', 'eighth', 'dotted-eighth', 'sixteenth'];

  const updateNote = useCallback((noteIndex: number, updates: Partial<VexNote>) => {
    if (!onNotesChange) return;

    const newNotes = [...notes];
    newNotes[noteIndex] = { ...newNotes[noteIndex], ...updates };
    onNotesChange(newNotes);
  }, [notes, onNotesChange]);

  const deleteNote = useCallback((noteIndex: number, noteInChordIndex: number) => {
    if (!onNotesChange) return;

    const note = notes[noteIndex];
    if (note.notes.length === 1) {
      // Delete entire note
      const newNotes = notes.filter((_, idx) => idx !== noteIndex);
      onNotesChange(newNotes);
    } else {
      // Delete single note from chord
      const newNoteArray = note.notes.filter((_, idx) => idx !== noteInChordIndex);
      updateNote(noteIndex, { notes: newNoteArray });
    }
    setSelectedNote(null);
  }, [notes, onNotesChange, updateNote]);

  const changePitch = useCallback((noteIndex: number, noteInChordIndex: number, direction: 'up' | 'down') => {
    const note = notes[noteIndex];
    const noteStr = note.notes[noteInChordIndex];
    const [noteName, octaveStr] = noteStr.split('/');
    const octave = parseInt(octaveStr);

    // Note sequence: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
    const noteSequence = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    let currentIndex = noteSequence.indexOf(noteName);
    let newOctave = octave;

    if (direction === 'up') {
      currentIndex++;
      if (currentIndex >= noteSequence.length) {
        currentIndex = 0;
        newOctave++;
      }
    } else {
      currentIndex--;
      if (currentIndex < 0) {
        currentIndex = noteSequence.length - 1;
        newOctave--;
      }
    }

    const newNote = `${noteSequence[currentIndex]}/${newOctave}`;
    const newNotes = [...note.notes];
    newNotes[noteInChordIndex] = newNote;
    updateNote(noteIndex, { notes: newNotes });
  }, [notes, updateNote]);

  const cycleDuration = useCallback((noteIndex: number) => {
    const note = notes[noteIndex];
    const currentDurationIndex = durations.indexOf(note.duration);
    const nextDurationIndex = (currentDurationIndex + 1) % durations.length;
    updateNote(noteIndex, { duration: durations[nextDurationIndex] });
  }, [notes, updateNote, durations]);

  const addNote = useCallback((beat: number, pitch: string = 'C/4') => {
    if (!onNotesChange) return;

    const newNote: VexNote = {
      notes: [pitch],
      duration: 'quarter',
      beat,
      id: `note-${Date.now()}-${Math.random()}`,
    };

    const newNotes = [...notes, newNote].sort((a, b) => a.beat - b.beat);
    onNotesChange(newNotes);
  }, [notes, onNotesChange]);

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedNote) return;

      // Prevent if typing in input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteNote(selectedNote.noteIndex, selectedNote.noteInChordIndex);
          break;
        case 'ArrowUp':
          e.preventDefault();
          changePitch(selectedNote.noteIndex, selectedNote.noteInChordIndex, 'up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          changePitch(selectedNote.noteIndex, selectedNote.noteInChordIndex, 'down');
          break;
        case 'd':
        case 'D':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            cycleDuration(selectedNote.noteIndex);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNote, deleteNote, changePitch, cycleDuration]);

  useEffect(() => {
    if (!containerRef.current || notes.length === 0) return;

    try {
      // Clear previous render
      containerRef.current.innerHTML = '';

      // Calculate dimensions
      const measuresCount = Math.ceil(notes[notes.length - 1]?.beat / 4) || 1;
      const pixelsPerMeasure = 200;
      const totalWidth = Math.max(measuresCount * pixelsPerMeasure, 600);
      const height = 200;

      // Create renderer
      const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
      renderer.resize(totalWidth, height);

      const context = renderer.getContext();
      context.setFont('Arial', 10);

      const svg = containerRef.current.querySelector('svg');
      svgRef.current = svg;

      // Group notes by measure
      const measureGroups: VexNote[][] = [];
      for (let i = 0; i < measuresCount; i++) {
        measureGroups[i] = [];
      }

      notes.forEach(note => {
        const measureIndex = Math.floor(note.beat / 4);
        if (measureIndex < measuresCount) {
          measureGroups[measureIndex].push(note);
        }
      });

      // Render each measure
      let xOffset = 10;
      const staveY = 40;

      measureGroups.forEach((measureNotes, measureIndex) => {
        // Create stave
        const stave = new Stave(xOffset, staveY, pixelsPerMeasure - 20);

        if (measureIndex === 0) {
          stave.addClef('treble').addTimeSignature('4/4');
        }

        stave.setContext(context).draw();

        if (measureNotes.length > 0) {
          const durationMap: Record<NoteDuration, string> = {
            'whole': 'w',
            'half': 'h',
            'dotted-half': 'hd',
            'quarter': 'q',
            'dotted-quarter': 'qd',
            'eighth': '8',
            'dotted-eighth': '8d',
            'sixteenth': '16',
          };

          const vexNotes = measureNotes.map(note => {
            const vexDuration = durationMap[note.duration] || 'q';
            return new StaveNote({
              keys: note.notes,
              duration: vexDuration,
            });
          });

          const beams = Beam.generateBeams(vexNotes);

          const voice = new Voice({
            numBeats: 4,
            beatValue: 4,
          });
          voice.addTickables(vexNotes);

          new Formatter()
            .joinVoices([voice])
            .format([voice], pixelsPerMeasure - 40);

          voice.draw(context, stave);
          beams.forEach(beam => beam.setContext(context).draw());

          // Add chord labels
          measureNotes.forEach((note, idx) => {
            if (note.chordLabel && idx === 0) {
              context.save();
              context.setFont('Arial', 12, 'bold');
              context.fillText(note.chordLabel, xOffset + 10, staveY - 10);
              context.restore();
            }
          });
        }

        xOffset += pixelsPerMeasure;
      });

      // Add click handlers
      if (svg) {
        const noteElements = svg.querySelectorAll('.vf-notehead');
        noteElements.forEach((elem, globalIndex) => {
          // Calculate which note this belongs to
          let accumulatedNotes = 0;
          let noteIndex = -1;
          let noteInChordIndex = -1;

          for (let i = 0; i < notes.length; i++) {
            const noteCount = notes[i].notes.length;
            if (globalIndex < accumulatedNotes + noteCount) {
              noteIndex = i;
              noteInChordIndex = globalIndex - accumulatedNotes;
              break;
            }
            accumulatedNotes += noteCount;
          }

          if (noteIndex >= 0) {
            (elem as SVGElement).style.cursor = 'pointer';

            elem.addEventListener('click', (e) => {
              e.stopPropagation();

              if ((e as MouseEvent).shiftKey) {
                // Shift+click: cycle duration
                cycleDuration(noteIndex);
              } else {
                // Regular click: select
                setSelectedNote({ noteIndex, noteInChordIndex });
              }
            });

            elem.addEventListener('mouseenter', () => {
              setHoveredNote({ noteIndex, noteInChordIndex });
              (elem as SVGElement).style.fill = '#3b82f6';
            });

            elem.addEventListener('mouseleave', () => {
              setHoveredNote(null);
              if (selectedNote?.noteIndex !== noteIndex || selectedNote?.noteInChordIndex !== noteInChordIndex) {
                (elem as SVGElement).style.fill = '';
              }
            });
          }
        });

        // Click on empty staff to add note
        svg.addEventListener('click', (e) => {
          const target = e.target as SVGElement;
          if (target.classList.contains('vf-notehead') || target.closest('.vf-notehead')) {
            return;
          }

          const rect = svg.getBoundingClientRect();
          const x = e.clientX - rect.left;

          // Calculate beat from x position
          const measureWidth = 200;
          const beat = Math.round((x - 10) / measureWidth * 4);

          if (beat >= 0) {
            addNote(beat);
          }
        });
      }

      onRenderComplete?.();
    } catch (error) {
      console.error('Error rendering VexFlow notation:', error);
    }
  }, [notes, selectedNote, cycleDuration, addNote, onRenderComplete]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="vexflow-notation-container"
        style={{ minHeight: '200px', width: '100%', overflowX: 'visible' }}
      />

      {/* Note Editor Panel */}
      {selectedNote !== null && (
        <div className="absolute top-0 right-0 bg-white border-2 border-blue-500 rounded-lg shadow-lg p-4 min-w-[250px] z-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-800">Edit Note</h3>
            <button
              onClick={() => setSelectedNote(null)}
              className="text-slate-500 hover:text-slate-700 text-lg font-bold px-1"
            >
              ✕
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Current: {notes[selectedNote.noteIndex]?.notes[selectedNote.noteInChordIndex]}
              </label>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Duration: {notes[selectedNote.noteIndex]?.duration}
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => changePitch(selectedNote.noteIndex, selectedNote.noteInChordIndex, 'up')}
                className="px-3 py-1.5 bg-blue-500 text-white text-xs font-semibold rounded hover:bg-blue-600"
              >
                ▲ Pitch Up
              </button>
              <button
                onClick={() => changePitch(selectedNote.noteIndex, selectedNote.noteInChordIndex, 'down')}
                className="px-3 py-1.5 bg-blue-500 text-white text-xs font-semibold rounded hover:bg-blue-600"
              >
                ▼ Pitch Down
              </button>
            </div>

            <button
              onClick={() => cycleDuration(selectedNote.noteIndex)}
              className="w-full px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded hover:bg-green-600"
            >
              Change Duration (D)
            </button>

            <button
              onClick={() => deleteNote(selectedNote.noteIndex, selectedNote.noteInChordIndex)}
              className="w-full px-3 py-1.5 bg-red-500 text-white text-xs font-semibold rounded hover:bg-red-600"
            >
              Delete Note (Del)
            </button>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-200">
            <p className="text-[10px] text-slate-500">
              Keyboard: ↑↓ change pitch • D change duration • Del delete
            </p>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-2 text-xs text-slate-600 px-2">
        <span className="font-semibold">Click</span> note to edit •
        <span className="font-semibold"> Shift+Click</span> to change duration •
        <span className="font-semibold"> Click staff</span> to add note
      </div>
    </div>
  );
}
