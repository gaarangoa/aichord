'use client';

import { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Beam } from 'vexflow';

type NoteDuration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' |
                     'dotted-half' | 'dotted-quarter' | 'dotted-eighth';

interface VexNote {
  notes: string[]; // e.g., ['C/4', 'E/4', 'G/4'] for a C major chord
  duration: NoteDuration;
  beat: number;
  chordLabel?: string;
}

interface VexFlowNotationProps {
  notes: VexNote[];
  onNoteClick?: (noteIndex: number) => void;
  onRenderComplete?: () => void;
}

export default function VexFlowNotation({ notes, onNoteClick, onRenderComplete }: VexFlowNotationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

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
      rendererRef.current = renderer;

      const context = renderer.getContext();
      context.setFont('Arial', 10);

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

        // Add clef and time signature to first measure
        if (measureIndex === 0) {
          stave.addClef('treble').addTimeSignature('4/4');
        }

        stave.setContext(context).draw();

        // Convert notes to VexFlow format
        if (measureNotes.length > 0) {
          const vexNotes = measureNotes.map(note => {
            // Convert duration
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

            const vexDuration = durationMap[note.duration] || 'q';

            // Create StaveNote
            return new StaveNote({
              keys: note.notes,
              duration: vexDuration,
            });
          });

          // Auto-beam eighth notes and smaller
          const beams = Beam.generateBeams(vexNotes);

          // Create voice and add notes
          const voice = new Voice({
            numBeats: 4,
            beatValue: 4,
          });
          voice.addTickables(vexNotes);

          // Format and draw
          new Formatter()
            .joinVoices([voice])
            .format([voice], pixelsPerMeasure - 40);

          voice.draw(context, stave);

          // Draw beams
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

      // Add click handlers to SVG elements
      if (onNoteClick) {
        const svg = containerRef.current.querySelector('svg');
        if (svg) {
          const noteElements = svg.querySelectorAll('.vf-notehead');
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

  return (
    <div
      ref={containerRef}
      className="vexflow-notation-container"
      style={{ minHeight: '200px', width: '100%', overflowX: 'visible' }}
    />
  );
}
