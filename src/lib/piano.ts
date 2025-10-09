'use client';

import * as Tone from 'tone';
import { useState } from 'react';

export type Note = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
type NoteWithOctave = `${Note}${number}`;

class StringEnsemble {
  private synth: Tone.PolySynth | null = null;
  private isInitialized = false;
  private isContextStarted = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.initialize();
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing String Ensemble...');

      // Wait for user interaction to start the audio context
      if (!this.isContextStarted) {
        console.log('Waiting for user gesture to start audio context...');
        return;
      }

      // Create a lush reverb effect
      const reverb = new Tone.Reverb({
        decay: 4,
        preDelay: 0.01,
        wet: 0.6
      }).toDestination();

      // Create a chorus effect for a thicker sound
      const chorus = new Tone.Chorus({
        frequency: 1.5,
        delayTime: 3.5,
        depth: 0.7,
        feedback: 0.1,
        wet: 0.8
      }).connect(reverb);

      this.synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: {
          type: 'sawtooth',
        },
        envelope: {
          attack: 0.5,
          decay: 0.1,
          sustain: 0.9,
          release: 1,
        },
        volume: -12,
      }).connect(chorus);

      this.isInitialized = true;
      console.log('String Ensemble initialized successfully');
    } catch (error) {
      console.error('Failed to initialize String Ensemble:', error);
      this.isInitialized = false;
    }
  }

  async startContext(): Promise<void> {
    if (this.isContextStarted) return;

    try {
      console.log('Starting audio context on user gesture...');
      await Tone.start();
      await Tone.context.resume();
      this.isContextStarted = true;
      console.log('Audio context started.');
      
      // Now that the context is started, complete initialization
      await this.initialize();
    } catch (error) {
      console.error('Failed to start audio context:', error);
      throw error;
    }
  }

  private formatNote(note: Note, octave: number = 2): NoteWithOctave {
    const flatToSharp: Record<string, string> = {
      'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#',
    };
    const normalizedNote = flatToSharp[note] || note;
    return `${normalizedNote}${octave}` as NoteWithOctave;
  }

  private getNoteAtInterval(root: Note, semitones: number, octaveShift: number = 0): NoteWithOctave {
    const notes: Note[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const normalizedRoot = this.formatNote(root, 0).slice(0, -1) as Note;
    const rootIndex = notes.indexOf(normalizedRoot);

    if (rootIndex === -1) {
      console.error(`Invalid root note provided: ${root}`);
      return 'C4' as NoteWithOctave;
    }

    const totalSemitones = semitones + (octaveShift * 12);
    const newIndex = (rootIndex + totalSemitones);
    const octaveIncrease = Math.floor(newIndex / 12);
    const noteIndex = newIndex % 12;
    return this.formatNote(notes[noteIndex], 3 + octaveIncrease); // Start at octave 3 for a richer sound
  }

  private buildExtendedChord(root: Note, intervals: number[]): NoteWithOctave[] {
    const notes: NoteWithOctave[] = [];
    let octave = 0;

    while (octave < 2) { // Create a 2-octave voicing
      intervals.forEach(interval => {
        notes.push(this.getNoteAtInterval(root, interval, octave));
      });
      octave++;
    }
    return notes;
  }

  async playChord(root: Note, intervals: number[], durationSeconds: number = 2): Promise<void> {
    if (!this.synth || !this.isInitialized) {
      console.warn('Synthesizer not ready. Please ensure audio is enabled.');
      return;
    }

    try {
      if (Tone.context.state !== 'running') {
        await Tone.context.resume();
      }

      const chordNotes = this.buildExtendedChord(root, intervals);
      console.log('Playing string chord:', chordNotes);
      const duration = Math.max(0.1, durationSeconds);
      this.synth.triggerAttackRelease(chordNotes, duration); // duration in seconds
    } catch (error) {
      console.error('Failed to play chord:', error);
      throw error;
    }
  }

  stopAllNotes(): void {
    if (this.synth) {
      this.synth.releaseAll();
      console.log('All string notes stopped.');
    }
  }

  dispose(): void {
    if (this.synth) {
      this.synth.dispose();
    }
  }
}

export function usePianoSynthesizer() {
  const [ensemble] = useState(() => new StringEnsemble());

  return {
    playChord: (root: Note, intervals: number[], durationSeconds?: number) => ensemble.playChord(root, intervals, durationSeconds),
    initialize: () => ensemble.initialize(),
    startContext: () => ensemble.startContext(),
    stopAllNotes: () => ensemble.stopAllNotes(),
  };
}
