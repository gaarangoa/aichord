'use client';

import * as Tone from 'tone';
import { useState } from 'react';

export type SharpNote = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
export type Note = SharpNote | 'Db' | 'Eb' | 'Gb' | 'Ab' | 'Bb';
type NoteWithOctave = `${SharpNote}${number}`;

const SHARP_NOTES: SharpNote[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP: Record<string, SharpNote> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
};

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

  private normalizeNoteName(note: Note): SharpNote {
    const normalized = FLAT_TO_SHARP[note] ?? note;
    if (SHARP_NOTES.includes(normalized as SharpNote)) {
      return normalized as SharpNote;
    }
    return 'C';
  }

  private noteToMidi(note: SharpNote, octave: number): number {
    const index = SHARP_NOTES.indexOf(note);
    return (octave + 1) * 12 + index;
  }

  private midiToNote(midi: number): NoteWithOctave {
    const wrapped = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const noteName = SHARP_NOTES[wrapped];
    return `${noteName}${octave}` as NoteWithOctave;
  }

  private buildExtendedChord(root: Note, intervals: number[], baseOctave: number = 1): NoteWithOctave[] {
    const normalizedRoot = this.normalizeNoteName(root);
    const clampedOctave = Math.max(-1, Math.min(8, baseOctave));
    const baseMidi = this.noteToMidi(normalizedRoot, clampedOctave); // Ensure root starts from user selection
    const midiNotes: number[] = [];

    for (let octave = 0; octave < 2; octave += 1) {
      intervals.forEach(interval => {
        const midi = baseMidi + interval + octave * 12;
        if (midi >= 0 && midi <= 127) {
          midiNotes.push(midi);
        }
      });
    }

    const uniqueSorted = Array.from(new Set(midiNotes)).sort((a, b) => a - b);
    return uniqueSorted.map(midi => this.midiToNote(midi));
  }

  async playChord(root: Note, intervals: number[], durationSeconds: number = 2, baseOctave: number = 1): Promise<void> {
    if (!this.synth || !this.isInitialized) {
      console.warn('Synthesizer not ready. Please ensure audio is enabled.');
      return;
    }

    try {
      if (Tone.context.state !== 'running') {
        await Tone.context.resume();
      }

      const chordNotes = this.buildExtendedChord(root, intervals, baseOctave);
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
    playChord: (root: Note, intervals: number[], durationSeconds?: number, baseOctave?: number) =>
      ensemble.playChord(root, intervals, durationSeconds, baseOctave),
    initialize: () => ensemble.initialize(),
    startContext: () => ensemble.startContext(),
    stopAllNotes: () => ensemble.stopAllNotes(),
  };
}
