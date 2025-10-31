type NoteDuration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' |
                     'dotted-half' | 'dotted-quarter' | 'dotted-eighth';

interface NoteData {
  beat: number;
  note: string;
  octave: number;
  duration: NoteDuration;
  chordLabel?: string;
  velocity?: number;
}

interface VexNote {
  notes: string[]; // VexFlow format: ['C/4', 'E/4', 'G/4']
  duration: NoteDuration;
  beat: number;
  chordLabel?: string;
  velocities?: number[]; // Velocity for each note
  isRest?: boolean; // True if this is a rest
}

/**
 * Convert note name and octave to VexFlow format
 * VexFlow uses: C/4, D/4, E/4, etc.
 */
function noteToVexFlow(note: string, octave: number): string {
  // Convert note name (handle sharps and flats)
  let vexNote = note.toUpperCase();

  // VexFlow uses # for sharps and b for flats
  if (vexNote.includes('♯')) {
    vexNote = vexNote.replace('♯', '#');
  }
  if (vexNote.includes('♭')) {
    vexNote = vexNote.replace('♭', 'b');
  }

  return `${vexNote}/${octave}`;
}

/**
 * Convert chord notebook data to VexFlow format
 * Groups notes that occur at the same beat into chords
 */
export function convertToVexFlow(notes: NoteData[]): VexNote[] {
  if (notes.length === 0) return [];

  // Sort notes by beat
  const sortedNotes = [...notes].sort((a, b) => a.beat - b.beat);

  // Group notes by beat (for chords)
  const notesByBeat = new Map<number, NoteData[]>();
  sortedNotes.forEach(note => {
    if (!notesByBeat.has(note.beat)) {
      notesByBeat.set(note.beat, []);
    }
    notesByBeat.get(note.beat)!.push(note);
  });

  // Convert to VexFlow format
  const vexNotes: VexNote[] = [];

  notesByBeat.forEach((notesAtBeat, beat) => {
    // Convert all notes at this beat to VexFlow format
    const vexFlowNotes = notesAtBeat.map(n => noteToVexFlow(n.note, n.octave));
    const velocities = notesAtBeat.map(n => n.velocity || 96);

    // Use the duration from the first note (all notes at same beat should have same duration)
    const duration = notesAtBeat[0].duration;
    const chordLabel = notesAtBeat[0].chordLabel;

    vexNotes.push({
      notes: vexFlowNotes,
      duration,
      beat,
      chordLabel,
      velocities,
      isRest: false,
    });
  });

  return vexNotes;
}

/**
 * Helper to add rests to VexFlow notes array
 */
export function addRestsToVexFlow(
  vexNotes: VexNote[]
): VexNote[] {
  if (vexNotes.length === 0) return [];

  const notesWithRests: VexNote[] = [];
  let currentBeat = 0;

  vexNotes.forEach(note => {
    // Add rest if there's a gap
    if (note.beat > currentBeat) {
      const restDuration = note.beat - currentBeat;

      // Add whole note rests for complete measures
      while (restDuration >= 4 && currentBeat < note.beat) {
        notesWithRests.push({
          notes: ['B/4'], // VexFlow rest position
          duration: 'whole',
          beat: currentBeat,
          isRest: true,
        });
        currentBeat += 4;
      }

      // Add remaining rest if needed
      const remainingRest = note.beat - currentBeat;
      if (remainingRest > 0) {
        const restDur: NoteDuration =
          remainingRest >= 2 ? 'half' :
          remainingRest >= 1 ? 'quarter' :
          remainingRest >= 0.5 ? 'eighth' : 'sixteenth';

        notesWithRests.push({
          notes: ['B/4'],
          duration: restDur,
          beat: currentBeat,
          isRest: true,
        });
        currentBeat = note.beat;
      }
    }

    notesWithRests.push(note);

    // Update current beat based on note duration
    const durationBeats = getDurationInBeats(note.duration);
    currentBeat = note.beat + durationBeats;
  });

  return notesWithRests;
}

/**
 * Helper to get duration in beats
 */
function getDurationInBeats(duration: NoteDuration): number {
  switch (duration) {
    case 'whole':
      return 4;
    case 'half':
      return 2;
    case 'dotted-half':
      return 3;
    case 'quarter':
      return 1;
    case 'dotted-quarter':
      return 1.5;
    case 'eighth':
      return 0.5;
    case 'dotted-eighth':
      return 0.75;
    case 'sixteenth':
      return 0.25;
    default:
      return 1;
  }
}
