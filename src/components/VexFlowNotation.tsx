'use client';

import { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental } from 'vexflow';

type NoteDuration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' |
                     'dotted-half' | 'dotted-quarter' | 'dotted-eighth';

interface VexNote {
  notes: string[]; // e.g., ['C/4', 'E/4', 'G/4'] for a C major chord
  duration: NoteDuration;
  beat: number;
  chordLabel?: string;
  velocities?: number[];
  isRest?: boolean;
}

interface VexFlowNotationProps {
  notes: VexNote[];
  onNoteClick?: (noteIndex: number) => void;
  onRenderComplete?: () => void;
  currentPlaybackBeat?: number | null;
}

// Helper function to get duration in beats
function getDurationBeats(duration: NoteDuration): number {
  switch (duration) {
    case 'whole': return 4;
    case 'half': return 2;
    case 'dotted-half': return 3;
    case 'quarter': return 1;
    case 'dotted-quarter': return 1.5;
    case 'eighth': return 0.5;
    case 'dotted-eighth': return 0.75;
    case 'sixteenth': return 0.25;
    default: return 1;
  }
}

export default function VexFlowNotation({ notes, onNoteClick, onRenderComplete, currentPlaybackBeat }: VexFlowNotationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const noteElementsRef = useRef<SVGElement[]>([]);
  const pixelsPerBeatRef = useRef<number>(50); // Default: 200px per measure / 4 beats

  useEffect(() => {
    if (!containerRef.current || notes.length === 0) return;

    try {
      // Clear previous render
      containerRef.current.innerHTML = '';

      // Calculate total beats including the duration of the last note
      const lastNote = notes[notes.length - 1];
      const lastNoteDuration = lastNote ? getDurationBeats(lastNote.duration) : 0;
      const totalBeats = lastNote ? lastNote.beat + lastNoteDuration : 4;
      const measuresCount = Math.ceil(totalBeats / 4) || 1;

      const pixelsPerMeasure = 200;
      const totalWidth = Math.max(measuresCount * pixelsPerMeasure, 600);
      const height = 200;

      // Store pixels per beat for scroll calculations
      pixelsPerBeatRef.current = pixelsPerMeasure / 4; // 4 beats per measure

      // Create renderer
      const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
      renderer.resize(totalWidth, height);
      rendererRef.current = renderer;

      const context = renderer.getContext();
      context.setFont('Arial', 10);

      // Create a single continuous stave
      const staveY = 40;
      const stave = new Stave(10, staveY, totalWidth - 20);
      stave.addClef('treble').addTimeSignature('4/4');
      stave.setContext(context).draw();

      // Convert all notes to VexFlow format
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

      const vexNotes = notes.map(note => {
        const vexDuration = durationMap[note.duration] || 'q';
        const staveNote = new StaveNote({
          keys: note.notes,
          duration: note.isRest ? `${vexDuration}r` : vexDuration, // Add 'r' suffix for rests
        });

        // Add accidentals (sharps and flats) to each note (only for actual notes, not rests)
        if (!note.isRest) {
          note.notes.forEach((noteKey, index) => {
            if (noteKey.includes('#')) {
              staveNote.addModifier(new Accidental('#'), index);
            } else if (noteKey.includes('b')) {
              staveNote.addModifier(new Accidental('b'), index);
            }
          });
        }

        return staveNote;
      });

      // Calculate actual total beats used by notes
      const actualBeats = notes.reduce((total, note) => {
        return total + getDurationBeats(note.duration);
      }, 0);

      // Auto-beam eighth notes and smaller
      const beams = Beam.generateBeams(vexNotes);

      // Create voice with the exact number of beats the notes use
      const voice = new Voice({
        numBeats: actualBeats,
        beatValue: 4,
      });
      voice.addTickables(vexNotes);

      // Format and draw
      new Formatter()
        .joinVoices([voice])
        .format([voice], totalWidth - 60);

      voice.draw(context, stave);

      // Draw beams
      beams.forEach(beam => beam.setContext(context).draw());

      // Add chord labels
      notes.forEach((note, idx) => {
        if (note.chordLabel) {
          // Calculate approximate x position for this note
          const noteX = 50 + (idx * (totalWidth - 60) / notes.length);
          context.save();
          context.setFont('Arial', 12, 'bold');
          context.fillText(note.chordLabel, noteX, staveY - 10);
          context.restore();
        }
      });

      // Store note elements and add click handlers
      const svg = containerRef.current.querySelector('svg');
      if (svg) {
        const noteElements = svg.querySelectorAll('.vf-stavenote');
        noteElementsRef.current = Array.from(noteElements) as SVGElement[];

        if (onNoteClick) {
          noteElements.forEach((elem, index) => {
            elem.addEventListener('click', () => onNoteClick(index));
            (elem as SVGElement).style.cursor = 'pointer';
          });
        }
      }

      onRenderComplete?.();
    } catch (error) {
      console.error('Error rendering VexFlow notation:', error);
    }

    // Cleanup
    return () => {
      rendererRef.current = null;
    };
  }, [notes, onNoteClick, onRenderComplete]);

  // Highlight notes based on playback position and auto-scroll
  useEffect(() => {
    if (!noteElementsRef.current.length || currentPlaybackBeat === null || currentPlaybackBeat === undefined) {
      // Clear all highlights when not playing
      noteElementsRef.current.forEach(elem => {
        const noteheads = elem.querySelectorAll('.vf-notehead');
        noteheads.forEach(notehead => {
          (notehead as SVGElement).style.fill = '#000';
        });
      });
      return;
    }

    // Find which note(s) should be highlighted
    notes.forEach((note, index) => {
      const elem = noteElementsRef.current[index];
      if (!elem) return;

      const noteheads = elem.querySelectorAll('.vf-notehead');
      const isPlaying = currentPlaybackBeat >= note.beat &&
                        currentPlaybackBeat < note.beat + getDurationBeats(note.duration);

      noteheads.forEach(notehead => {
        (notehead as SVGElement).style.fill = isPlaying ? '#3b82f6' : '#000';
        (notehead as SVGElement).style.transition = 'fill 0.1s ease';
      });
    });

    // Auto-scroll to keep the playback position visible
    if (containerRef.current) {
      const scrollContainer = containerRef.current.parentElement;
      if (scrollContainer) {
        const scrollTarget = currentPlaybackBeat * pixelsPerBeatRef.current;
        // Center the playback position in the viewport
        const targetScroll = Math.max(0, scrollTarget - scrollContainer.clientWidth / 2);
        scrollContainer.scrollLeft = targetScroll;
      }
    }
  }, [currentPlaybackBeat, notes]);

  return (
    <div
      ref={containerRef}
      className="vexflow-notation-container"
      style={{ minHeight: '200px', width: '100%', overflowX: 'visible' }}
    />
  );
}
