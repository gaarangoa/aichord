'use client';

import * as Tone from 'tone';
import { useMemo, useState } from 'react';

export type SharpNote = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
export type Note = SharpNote | 'Db' | 'Eb' | 'Gb' | 'Ab' | 'Bb';
type NoteWithOctave = `${SharpNote}${number}`;

export interface PlayChordOptions {
  durationSeconds?: number;
  baseOctave?: number;
  velocity?: number;
  velocityVariancePercent?: number;
  arpeggioIntervalMs?: number;
  timingJitterPercent?: number;
}

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

  async playChord(
    root: Note,
    intervals: number[],
    {
      durationSeconds = 2,
      baseOctave = 1,
      velocity = 96,
      velocityVariancePercent = 10,
      arpeggioIntervalMs = 120,
      timingJitterPercent = 0,
    }: PlayChordOptions = {}
  ): Promise<void> {
    if (!this.synth || !this.isInitialized) {
      console.warn('Synthesizer not ready. Please ensure audio is enabled.');
      return;
    }

    try {
      if (Tone.context.state !== 'running') {
        await Tone.context.resume();
      }

      const chordNotes = this.buildExtendedChord(root, intervals, baseOctave).slice(0, 10);
      console.log('Playing string chord:', chordNotes);
      const duration = Math.max(0.1, durationSeconds);
      const baseVelocity = Math.max(1, Math.min(127, Math.round(velocity)));

      const intervalSeconds = Math.max(0.02, arpeggioIntervalMs / 1000);
      const jitterRange = Math.max(0, Math.min(1, timingJitterPercent / 100));
      const velocityVarianceRange = Math.max(0, Math.min(100, velocityVariancePercent)) / 100;
      // All notes get the full hold duration
      const perNoteDuration = duration;
      let nextTime = Tone.now();

      chordNotes.forEach((noteWithOctave, index) => {
        if (index > 0) {
          const jitterFactor = jitterRange > 0 ? 1 + (Math.random() * 2 - 1) * jitterRange : 1;
          nextTime += intervalSeconds * jitterFactor;
        }

        // Apply velocity variance based on percentage of base velocity
        const maxVariance = baseVelocity * velocityVarianceRange;
        const velocityOffset = Math.round((Math.random() * 2 - 1) * maxVariance);
        const noteVelocity = Math.max(1, Math.min(127, baseVelocity + velocityOffset));
        const velocityScalar = Math.max(0.05, Math.min(1, noteVelocity / 127));
        const attackJitter = Math.random() * 0.03; // up to 30ms for subtle variation

        this.synth?.triggerAttackRelease(
          noteWithOctave,
          perNoteDuration,
          nextTime + attackJitter,
          velocityScalar
        );
      });
    } catch (error) {
      console.error('Failed to play chord:', error);
      throw error;
    }
  }

  async playNoteSequence(
    notes: Array<{ note: string; octave: number; startOffset: number; duration: number }>,
    options: { velocity?: number; velocityVariancePercent?: number } = {}
  ): Promise<void> {
    if (!this.synth || !this.isInitialized) {
      console.warn('Synthesizer not ready. Please ensure audio is enabled.');
      return;
    }

    try {
      if (Tone.context.state !== 'running') {
        await Tone.context.resume();
      }

      const { velocity = 96, velocityVariancePercent = 10 } = options;
      const baseVelocity = Math.max(1, Math.min(127, Math.round(velocity)));
      const velocityVarianceRange = Math.max(0, Math.min(100, velocityVariancePercent)) / 100;

      const startTime = Tone.now();
      console.log(`Starting note sequence at ${startTime}, ${notes.length} notes`);

      notes.forEach((noteEvent, idx) => {
        const normalizedNote = this.normalizeNoteName(noteEvent.note as Note);
        const noteWithOctave = `${normalizedNote}${noteEvent.octave}` as NoteWithOctave;

        // Apply velocity variance
        const maxVariance = baseVelocity * velocityVarianceRange;
        const velocityOffset = Math.round((Math.random() * 2 - 1) * maxVariance);
        const noteVelocity = Math.max(1, Math.min(127, baseVelocity + velocityOffset));
        const velocityScalar = Math.max(0.05, Math.min(1, noteVelocity / 127));

        const attackTime = startTime + noteEvent.startOffset;
        const attackJitter = Math.random() * 0.01; // up to 10ms for subtle variation

        console.log(`  [${idx}] ${noteWithOctave} @ ${noteEvent.startOffset}s (abs: ${attackTime.toFixed(3)}), duration: ${noteEvent.duration}s`);

        this.synth?.triggerAttackRelease(
          noteWithOctave,
          noteEvent.duration,
          attackTime + attackJitter,
          velocityScalar
        );
      });

      console.log('Note sequence scheduled successfully');
    } catch (error) {
      console.error('Failed to play note sequence:', error);
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

  return useMemo(() => ({
    playChord: (root: Note, intervals: number[], options?: PlayChordOptions) =>
      ensemble.playChord(root, intervals, options),
    playNoteSequence: (
      notes: Array<{ note: string; octave: number; startOffset: number; duration: number }>,
      options?: { velocity?: number; velocityVariancePercent?: number }
    ) => ensemble.playNoteSequence(notes, options),
    initialize: () => ensemble.initialize(),
    startContext: () => ensemble.startContext(),
    stopAllNotes: () => ensemble.stopAllNotes(),
  }), [ensemble]);
}
