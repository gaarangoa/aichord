type NoteDuration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' |
                     'dotted-half' | 'dotted-quarter' | 'dotted-eighth';

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

/**
 * Convert note name and octave to ABC notation
 * ABC uses C,, for lower octaves, C for middle C (octave 4), c for octave 5, c' for octave 6, etc.
 */
function noteToAbc(note: string, octave: number): string {
  // Remove sharp/flat for base note
  const baseName = note.charAt(0).toUpperCase();
  const accidental = note.length > 1 ? note.charAt(1) : '';

  // Convert accidentals to ABC format
  const abcAccidental = accidental === '#' ? '^' : accidental === 'b' ? '_' : '';

  // ABC notation octave system:
  // octave 2: C,, D,, E,, etc (very low)
  // octave 3: C, D, E, etc (low)
  // octave 4: C D E F G A B (middle C)
  // octave 5: c d e f g a b (high)
  // octave 6: c' d' e' etc (very high)
  // octave 7: c'' d'' e'' etc (higher)

  let abcNote = '';

  if (octave <= 3) {
    // Use uppercase with commas for octaves 3 and below
    abcNote = baseName;
    const commas = 4 - octave;
    for (let i = 0; i < commas; i++) {
      abcNote += ',';
    }
  } else if (octave === 4) {
    // Middle octave uses uppercase
    abcNote = baseName;
  } else {
    // Octaves 5 and above use lowercase with apostrophes
    abcNote = baseName.toLowerCase();
    const apostrophes = octave - 5;
    for (let i = 0; i < apostrophes; i++) {
      abcNote += "'";
    }
  }

  return abcAccidental + abcNote;
}

/**
 * Convert duration to ABC notation
 * ABC uses: 8 for whole, 4 for half, 2 for quarter, 1 for eighth, /2 for sixteenth
 * Default (no number) is quarter note
 */
function durationToAbc(duration: NoteDuration): string {
  switch (duration) {
    case 'whole':
      return '8';
    case 'half':
      return '4';
    case 'dotted-half':
      return '6'; // 4 + 4/2 = 6 eighth notes
    case 'quarter':
      return '2';
    case 'dotted-quarter':
      return '3'; // 2 + 2/2 = 3 eighth notes
    case 'eighth':
      return '1';
    case 'dotted-eighth':
      return '3/2'; // 1 + 1/2 = 1.5 eighth notes
    case 'sixteenth':
      return '/2';
    default:
      return '2'; // Default to quarter
  }
}

/**
 * Convert chord notebook data to ABC notation string
 */
export function convertToAbcNotation(
  notes: NoteData[],
  silences: SilenceData[],
  bpm: number = 120
): string {
  if (notes.length === 0 && silences.length === 0) {
    return '';
  }

  // Start ABC notation header
  let abc = 'X:1\n'; // Reference number
  abc += 'T:\n'; // Title (empty)
  abc += 'M:4/4\n'; // Time signature (4/4)
  abc += 'L:1/8\n'; // Default note length (eighth note)
  abc += `Q:1/4=${bpm}\n`; // Tempo
  abc += 'K:C\n'; // Key signature (C major for simplicity)

  // Combine notes and silences, sort by beat
  const allEvents: Array<{beat: number; type: 'note' | 'silence'; data: NoteData | SilenceData}> = [
    ...notes.map(n => ({ beat: n.beat, type: 'note' as const, data: n })),
    ...silences.map(s => ({ beat: s.beat, type: 'silence' as const, data: s }))
  ];

  allEvents.sort((a, b) => a.beat - b.beat);

  // Group notes by beat position for chords
  const notesByBeat = new Map<number, NoteData[]>();
  notes.forEach(note => {
    if (!notesByBeat.has(note.beat)) {
      notesByBeat.set(note.beat, []);
    }
    notesByBeat.get(note.beat)!.push(note);
  });

  let currentBeat = 0;
  let currentMeasureBeat = 0;

  // Convert to ABC notation
  for (let i = 0; i < allEvents.length; i++) {
    const event = allEvents[i];

    // Add measure bars
    while (currentMeasureBeat > 0 && currentMeasureBeat % 4 === 0 && currentBeat < event.beat) {
      abc += '|';
      currentMeasureBeat = 0;
    }

    // Add rests if there's a gap
    if (event.beat > currentBeat) {
      const gapBeats = event.beat - currentBeat;
      const gapInEighths = Math.round(gapBeats * 2); // Convert to eighth notes
      if (gapInEighths > 0) {
        abc += `z${gapInEighths}`;
        currentBeat += gapBeats;
        currentMeasureBeat += gapBeats;
      }
    }

    if (event.type === 'silence') {
      const silence = event.data as SilenceData;
      const totalBeats = silence.measures * 4;
      const totalEighths = totalBeats * 2;
      abc += `z${totalEighths}`;
      currentBeat += totalBeats;
      currentMeasureBeat += totalBeats;
    } else {
      const notesAtBeat = notesByBeat.get(event.beat) || [];

      // Skip if we already processed this beat
      if (i > 0 && allEvents[i - 1].beat === event.beat) {
        continue;
      }

      if (notesAtBeat.length > 1) {
        // Multiple notes = chord
        abc += '[';
        notesAtBeat.forEach((note, idx) => {
          abc += noteToAbc(note.note, note.octave);
          if (idx === 0) {
            abc += durationToAbc(note.duration);
          }
        });
        abc += ']';

        const durationBeats = getDurationInBeats(notesAtBeat[0].duration);
        currentBeat += durationBeats;
        currentMeasureBeat += durationBeats;
      } else if (notesAtBeat.length === 1) {
        // Single note
        const note = notesAtBeat[0];
        abc += noteToAbc(note.note, note.octave);
        abc += durationToAbc(note.duration);

        const durationBeats = getDurationInBeats(note.duration);
        currentBeat += durationBeats;
        currentMeasureBeat += durationBeats;
      }

      // Add chord symbols if available
      const note = notesAtBeat[0];
      if (note?.chordLabel && i === 0 || (i > 0 && allEvents[i - 1].beat !== event.beat)) {
        abc += `"${note.chordLabel}"`;
      }
    }

    // Add measure bar if we're at measure boundary
    if (currentMeasureBeat >= 4) {
      while (currentMeasureBeat >= 4) {
        currentMeasureBeat -= 4;
      }
    }
  }

  // Final measure bar
  abc += '|]';

  return abc;
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
