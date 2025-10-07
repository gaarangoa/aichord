import { useCallback, useRef } from 'react';

type Note = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
type Octave = 3 | 4 | 5;

class Synthesizer {
  private audioContext: AudioContext;
  private gain: GainNode;

  constructor() {
    this.audioContext = new AudioContext();
    this.gain = this.audioContext.createGain();
    this.gain.connect(this.audioContext.destination);
    this.gain.gain.value = 0.1; // Reduce volume
  }

  private noteToFrequency(note: Note, octave: Octave): number {
    const notes: Note[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const baseFreq = 440; // A4
    const baseOctave = 4;
    const baseNoteIndex = notes.indexOf('A');
    const noteIndex = notes.indexOf(note);
    
    const semitonesFromA4 = (octave - baseOctave) * 12 + (noteIndex - baseNoteIndex);
    return baseFreq * Math.pow(2, semitonesFromA4 / 12);
  }

  private createOscillator(frequency: number): OscillatorNode {
    const oscillator = this.audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    return oscillator;
  }

  playChord(notes: [Note, Octave][], duration: number = 1): void {
    const oscillators = notes.map(([note, octave]) => {
      const oscillator = this.createOscillator(this.noteToFrequency(note, octave));
      oscillator.connect(this.gain);
      return oscillator;
    });

    oscillators.forEach(osc => osc.start());
    oscillators.forEach(osc => {
      osc.stop(this.audioContext.currentTime + duration);
    });
  }

  playMajorChord(root: Note, octave: Octave = 4): void {
    const notes: Note[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const rootIndex = notes.indexOf(root);
    
    // Major chord: root, major third (4 semitones up), perfect fifth (7 semitones up)
    const third = notes[(rootIndex + 4) % 12] as Note;
    const fifth = notes[(rootIndex + 7) % 12] as Note;
    
    this.playChord([
      [root, octave],
      [third, octave],
      [fifth, octave]
    ]);
  }

  playMinorChord(root: Note, octave: Octave = 4): void {
    const notes: Note[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const rootIndex = notes.indexOf(root);
    
    // Minor chord: root, minor third (3 semitones up), perfect fifth (7 semitones up)
    const third = notes[(rootIndex + 3) % 12] as Note;
    const fifth = notes[(rootIndex + 7) % 12] as Note;
    
    this.playChord([
      [root, octave],
      [third, octave],
      [fifth, octave]
    ]);
  }
}

export const useSynthesizer = () => {
  const synthRef = useRef<Synthesizer | null>(null);

  const getSynth = useCallback(() => {
    if (!synthRef.current) {
      synthRef.current = new Synthesizer();
    }
    return synthRef.current;
  }, []);

  return {
    playMajorChord: (root: Note) => getSynth().playMajorChord(root),
    playMinorChord: (root: Note) => getSynth().playMinorChord(root),
  };
};