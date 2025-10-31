type NoteDuration =
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | 'sixteenth'
  | 'dotted-half'
  | 'dotted-quarter'
  | 'dotted-eighth';

interface NoteData {
  beat: number;
  note: string;
  octave: number;
  duration: NoteDuration;
  chordLabel?: string;
}

interface SilenceData {
  beat: number;
  measures: number;
}

interface DurationSpec {
  base: number;
  dots: number;
  beats: number;
}

const DURATION_SPECS: Record<NoteDuration, DurationSpec> = {
  whole: { base: 1, dots: 0, beats: 4 },
  half: { base: 2, dots: 0, beats: 2 },
  'dotted-half': { base: 2, dots: 1, beats: 3 },
  quarter: { base: 4, dots: 0, beats: 1 },
  'dotted-quarter': { base: 4, dots: 1, beats: 1.5 },
  eighth: { base: 8, dots: 0, beats: 0.5 },
  'dotted-eighth': { base: 8, dots: 1, beats: 0.75 },
  sixteenth: { base: 16, dots: 0, beats: 0.25 },
};

const REST_DURATION_ORDER: DurationSpec[] = [
  DURATION_SPECS['whole'],
  DURATION_SPECS['dotted-half'],
  DURATION_SPECS['half'],
  DURATION_SPECS['dotted-quarter'],
  DURATION_SPECS['quarter'],
  DURATION_SPECS['dotted-eighth'],
  DURATION_SPECS['eighth'],
  DURATION_SPECS['sixteenth'],
];

const EPSILON = 1e-6;

const toFixedBeats = (value: number): number => {
  const rounded = Number(value.toFixed(6));
  return Math.abs(rounded) < EPSILON ? 0 : rounded;
};

const buildDotsSuffix = (dots: number): string => {
  if (dots === 0) {
    return '';
  }
  return dots === 2 ? ' { dd }' : ' { d }';
};

/**
 * Convert note name to AlphaTex format
 * AlphaTex uses: c, c#, db for note names
 */
function noteToAlphaTex(note: string, octave: number): string {
  let alphaNote = note.toLowerCase();

  if (alphaNote.includes('♯')) {
    alphaNote = alphaNote.replace('♯', '#');
  }
  if (alphaNote.includes('♭')) {
    alphaNote = alphaNote.replace('♭', 'b');
  }

  return `${alphaNote}${octave}`;
}

const getDurationSpec = (duration: NoteDuration): DurationSpec => {
  return DURATION_SPECS[duration] ?? DURATION_SPECS['quarter'];
};

const pickRestSpec = (beats: number): DurationSpec => {
  for (const spec of REST_DURATION_ORDER) {
    if (beats + EPSILON >= spec.beats) {
      return spec;
    }
  }
  return REST_DURATION_ORDER[REST_DURATION_ORDER.length - 1];
};

export function convertToAlphaTex(
  notes: NoteData[],
  silences: SilenceData[],
  bpm: number = 120,
  title: string = 'Chord Progression'
): string {
  if (notes.length === 0 && silences.length === 0) {
    return '';
  }

  // Start with just the track marker, no title or tempo
  let alphaTex = `.\n`;

  const notesByBeat = new Map<number, NoteData[]>();
  notes.forEach(note => {
    if (!notesByBeat.has(note.beat)) {
      notesByBeat.set(note.beat, []);
    }
    notesByBeat.get(note.beat)!.push(note);
  });

  interface BeatNoteEvent {
    type: 'note';
    beat: number;
    notes: NoteData[];
  }

  interface BeatSilenceEvent {
    type: 'silence';
    beat: number;
    measures: number;
  }

  const noteEvents: BeatNoteEvent[] = Array.from(notesByBeat.entries())
    .map(([beat, beatNotes]) => ({
      type: 'note' as const,
      beat,
      notes: beatNotes,
    }))
    .sort((a, b) => a.beat - b.beat);

  const silenceEvents: BeatSilenceEvent[] = silences
    .map(silence => ({
      type: 'silence' as const,
      beat: silence.beat,
      measures: silence.measures,
    }))
    .sort((a, b) => a.beat - b.beat);

  const beatEvents = [...noteEvents, ...silenceEvents].sort((a, b) => a.beat - b.beat);

  const eventChunks: string[] = [];

  let currentBeat = 0;
  let currentMeasureBeat = 0;

  const finalizeBarlines = () => {
    while (currentMeasureBeat >= 4 - EPSILON) {
      eventChunks.push(' |');
      currentMeasureBeat = toFixedBeats(currentMeasureBeat - 4);
      if (currentMeasureBeat < EPSILON) {
        currentMeasureBeat = 0;
      }
    }
  };

  const appendRestBeats = (beats: number) => {
    let remaining = beats;
    while (remaining > EPSILON) {
      const spec = pickRestSpec(remaining);
      eventChunks.push(` :${spec.base} r${buildDotsSuffix(spec.dots)}`);
      currentBeat = toFixedBeats(currentBeat + spec.beats);
      currentMeasureBeat = toFixedBeats(currentMeasureBeat + spec.beats);
      finalizeBarlines();
      remaining = toFixedBeats(remaining - spec.beats);
    }
  };

  for (const event of beatEvents) {
    if (event.beat > currentBeat + EPSILON) {
      appendRestBeats(event.beat - currentBeat);
    }

    if (event.type === 'silence') {
      appendRestBeats(event.measures * 4);
      continue;
    }

    const orderedNotes = [...event.notes].sort((a, b) => {
      if (a.octave !== b.octave) {
        return a.octave - b.octave;
      }
      return a.note.localeCompare(b.note);
    });

    if (orderedNotes.length === 0) {
      continue;
    }

    const spec = getDurationSpec(orderedNotes[0].duration);
    const suffix = buildDotsSuffix(spec.dots);

    if (orderedNotes.length > 1) {
      const chordBody = orderedNotes.map(note => noteToAlphaTex(note.note, note.octave)).join(' ');
      eventChunks.push(` :${spec.base} (${chordBody})${suffix}`);
    } else {
      const note = orderedNotes[0];
      eventChunks.push(` :${spec.base} ${noteToAlphaTex(note.note, note.octave)}${suffix}`);
    }

    currentBeat = toFixedBeats(event.beat + spec.beats);
    currentMeasureBeat = toFixedBeats(currentMeasureBeat + spec.beats);
    finalizeBarlines();
  }

  if (eventChunks.length === 0 || eventChunks[eventChunks.length - 1] !== ' |') {
    eventChunks.push(' |');
  }

  alphaTex += eventChunks.join('');

  if (process.env.NODE_ENV !== 'production') {
    console.log('[alphaTex]', alphaTex);
  }

  return alphaTex;
}
