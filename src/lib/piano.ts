'use client';

import * as Tone from 'tone';
import { useState } from 'react';

export type Note = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
type NoteWithOctave = `${Note}${number}`;

class TonePiano {
  private sampler: Tone.Sampler | null = null;
  private isInitialized = false;
  private isContextStarted = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Starting audio initialization...');
      
      // Don't create any audio nodes until we have user interaction
      if (!this.isContextStarted) {
        console.log('Waiting for user interaction before starting audio context...');
        return;
      }

      // Then create the sampler
      this.sampler = new Tone.Sampler({
        urls: {
          C4: "C4.mp3",
          "D#4": "Ds4.mp3",
          "F#4": "Fs4.mp3",
          A4: "A4.mp3",
        },
        release: 1,
        baseUrl: "https://tonejs.github.io/audio/salamander/",
        onload: () => {
          console.log('Piano samples loaded successfully');
          this.isInitialized = true;
        },
        onerror: (error) => {
          console.error('Failed to load piano samples:', error);
          this.isInitialized = false;
        }
      }).toDestination();

      // Wait for the context to be running
      const context = Tone.context;
      await context.resume();
      
      // Wait for samples to load
      await Tone.loaded();

      console.log('Audio initialization complete');
      
    } catch (error) {
      console.warn('Audio initialization failed:', error);
      // Reset state so we can try again
      if (this.sampler) {
        this.sampler.dispose();
        this.sampler = null;
      }
      this.isInitialized = false;
      throw error;
    }
  }

  async startContext(): Promise<void> {
    if (!this.isContextStarted) {
      try {
        console.log('Starting Tone.js context on user interaction...');
        await Tone.start();
        await Tone.context.resume();
        this.isContextStarted = true;
        console.log('Tone.js context started successfully');
        
        // Now that we have user interaction, initialize fully
        await this.initialize();
      } catch (error) {
        console.error('Failed to start audio context:', error);
        throw error;
      }
    }
  }

  private formatNote(note: Note, octave: number = 2): NoteWithOctave {
    // Convert flats to sharps
    const flatToSharp: Record<string, string> = {
      'Db': 'C#',
      'Eb': 'D#',
      'Gb': 'F#',
      'Ab': 'G#',
      'Bb': 'A#',
    };
    
    const normalizedNote = flatToSharp[note] || note;
    return `${normalizedNote}${octave}` as NoteWithOctave;
  }

  private getNoteAtInterval(root: Note, semitones: number, octaveShift: number = 0): NoteWithOctave {
    const notes: Note[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    
    const flatToSharp: Record<string, string> = {
      'Db': 'C#',
      'Eb': 'D#',
      'Gb': 'F#',
      'Ab': 'G#',
      'Bb': 'A#',
    };
    const normalizedRoot = (flatToSharp[root] || root) as Note;
    const rootIndex = notes.indexOf(normalizedRoot);

    if (rootIndex === -1) {
      console.error(`Invalid root note provided: ${root}`);
      // Return a default or throw an error
      return 'C4' as NoteWithOctave; 
    }

    const totalSemitones = semitones + (octaveShift * 12);
    const newIndex = (rootIndex + totalSemitones);
    const octaveIncrease = Math.floor(newIndex / 12);
    const noteIndex = newIndex % 12;
    return this.formatNote(notes[noteIndex], 2 + octaveIncrease);
  }

  private async playArpeggio(notes: NoteWithOctave[], noteLength = 0.4, interval = 0.25): Promise<void> {
    if (!this.sampler || !this.isInitialized) {
      console.warn('Sampler not initialized. Please wait for initialization.');
      return;
    }

    try {
      await Tone.loaded();
      await Tone.start();

      const now = Tone.now();
      notes.forEach((note, index) => {
        const time = now + (index * interval);
        // Play each note with slightly longer duration for better sustain
        this.sampler!.triggerAttackRelease(note, noteLength, time);
      });
    } catch (error) {
      console.error('Failed to play arpeggio:', error);
      throw error;
    }
  }

  private buildExtendedChord(root: Note, intervals: number[]): NoteWithOctave[] {
    const notes: NoteWithOctave[] = [];
    let octave = 0;

    // Create extended voicing across octaves
    while (octave <= 2) { // This will give us notes from octave 2 to 4
      intervals.forEach(interval => {
        notes.push(this.getNoteAtInterval(root, interval, octave));
      });
      octave++;
    }

    return notes;
  }

  async playMajorChord(root: Note): Promise<void> {
    if (!this.sampler || !this.isInitialized) {
      console.warn('Sampler not initialized. Please wait for initialization.');
      return;
    }

    try {
      // Ensure audio context is running
      if (Tone.context.state !== 'running') {
        console.log('Resuming audio context...');
        await Tone.context.resume();
      }

      // Major chord intervals: root(0), major third(4), perfect fifth(7)
      const chordNotes = this.buildExtendedChord(root, [0, 4, 7]);

      console.log('Playing extended major chord:', chordNotes);
      // Play ascending arpeggio
      await this.playArpeggio(chordNotes);
    } catch (error) {
      console.error('Failed to play major chord:', error);
      throw error;
    }
  }

  async playMinorChord(root: Note): Promise<void> {
    if (!this.sampler || !this.isInitialized) {
      console.warn('Sampler not initialized. Please wait for initialization.');
      return;
    }

    try {
      // Ensure audio context is running
      if (Tone.context.state !== 'running') {
        console.log('Resuming audio context...');
        await Tone.context.resume();
      }

      // Minor chord intervals: root(0), minor third(3), perfect fifth(7)
      const chordNotes = this.buildExtendedChord(root, [0, 3, 7]);
      
      console.log('Playing extended minor chord:', chordNotes);
      await this.playArpeggio(chordNotes);
    } catch (error) {
      console.error('Failed to play minor chord:', error);
      throw error;
    }

    try {
      console.log('Playing extended minor chord:', chordNotes);
      // Play ascending arpeggio
      await this.playArpeggio(chordNotes);
    } catch (error) {
      console.error('Failed to play minor chord:', error);
      throw error;
    }
  }

  async playChord(root: Note, intervals: number[]): Promise<void> {
    if (!this.sampler || !this.isInitialized) {
      console.warn('Sampler not initialized. Please wait for initialization.');
      return;
    }

    try {
      // Ensure audio context is running
      if (Tone.context.state !== 'running') {
        console.log('Resuming audio context...');
        await Tone.context.resume();
      }

      const chordNotes = this.buildExtendedChord(root, intervals);
      
      console.log('Playing extended chord:', chordNotes);
      await this.playArpeggio(chordNotes);
    } catch (error) {
      console.error('Failed to play chord:', error);
      throw error;
    }
  }

  stopAllNotes(): void {
    if (this.sampler) {
      this.sampler.releaseAll();
      console.log('All notes stopped.');
    }
  }

  dispose(): void {
    if (this.sampler) {
      this.sampler.dispose();
      this.sampler = null;
      this.isInitialized = false;
    }
  }
}

let pianoInstance: TonePiano | null = null;

export function usePianoSynthesizer() {
  const [piano] = useState(() => new TonePiano());

  return {
    playMajorChord: (root: Note) => piano.playMajorChord(root),
    playMinorChord: (root: Note) => piano.playMinorChord(root),
    playChord: (root: Note, intervals: number[]) => piano.playChord(root, intervals),
    initialize: () => piano.initialize(),
    startContext: () => piano.startContext(),
    stopAllNotes: () => piano.stopAllNotes(),
  };
}