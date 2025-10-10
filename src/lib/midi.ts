import { useCallback, useMemo, useRef, useState } from 'react';

const NOTE_SEQUENCE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
};

type NoteName = (typeof NOTE_SEQUENCE)[number];

export interface MidiOutputInfo {
  id: string;
  name: string;
  manufacturer?: string;
}

const normalizeNoteName = (note: string): NoteName | null => {
  const direct = NOTE_SEQUENCE.find(n => n === note);
  if (direct) {
    return direct;
  }

  const converted = FLAT_TO_SHARP[note];
  if (converted) {
    return converted as NoteName;
  }

  return null;
};

const baseMidiNumber = (note: NoteName, octave: number): number => {
  const index = NOTE_SEQUENCE.indexOf(note);
  return (octave + 1) * 12 + index; // MIDI note formula (C4 -> 60)
};

const buildMidiChord = (root: string, intervals: number[], baseOctave: number = 1): number[] => {
  const normalized = normalizeNoteName(root);
  if (!normalized) {
    return [];
  }

  const clampedOctave = Math.max(-1, Math.min(8, baseOctave));
  const rootMidi = baseMidiNumber(normalized, clampedOctave); // Anchor root to selected octave
  const noteSet = new Set<number>();

  intervals.forEach(interval => {
    const base = rootMidi + interval;
    if (base >= 0 && base <= 127) {
      noteSet.add(base);
    }
    const upper = base + 12;
    if (upper >= 0 && upper <= 127) {
      noteSet.add(upper);
    }
  });

  return Array.from(noteSet.values()).sort((a, b) => a - b);
};

interface SendChordOptions {
  durationMs?: number;
  baseOctave?: number;
  velocity?: number;
  playbackMode?: 'block' | 'arpeggio';
  arpeggioIntervalMs?: number;
}

export const useWebMidiChordSender = () => {
  const isSupported = useMemo(
    () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
    []
  );

  const midiAccessRef = useRef<WebMidi.MIDIAccess | null>(null);
  const selectedOutputRef = useRef<WebMidi.MIDIOutput | null>(null);
  const activeNotesRef = useRef<number[]>([]);
  const timersRef = useRef<number[]>([]);

  const [hasAccess, setHasAccess] = useState(false);
  const [outputs, setOutputs] = useState<MidiOutputInfo[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);

  const stopAll = useCallback(() => {
    timersRef.current.forEach(timerId => window.clearTimeout(timerId));
    timersRef.current = [];

    const output = selectedOutputRef.current;
    if (output && activeNotesRef.current.length > 0) {
      activeNotesRef.current.forEach(noteNumber => {
        output.send([0x80, noteNumber, 0]);
      });
    }
    activeNotesRef.current = [];
  }, []);

  const refreshOutputs = useCallback(() => {
    const access = midiAccessRef.current;
    if (!access) return;

    const nextOutputs: MidiOutputInfo[] = [];
    access.outputs.forEach(output => {
      nextOutputs.push({
        id: output.id,
        name: output.name ?? `Output ${nextOutputs.length + 1}`,
        manufacturer: output.manufacturer ?? undefined,
      });
    });
    setOutputs(nextOutputs);

    const currentId = selectedOutputRef.current?.id ?? null;
    if (currentId && !nextOutputs.some(output => output.id === currentId)) {
      stopAll();
      selectedOutputRef.current = null;
      setSelectedOutputId(null);
    }
  }, [stopAll]);

  const requestAccess = useCallback(async () => {
    if (!isSupported) {
      throw new Error('Web MIDI API is not supported in this browser.');
    }

    if (midiAccessRef.current) {
      setHasAccess(true);
      refreshOutputs();
      return;
    }

    const access = await navigator.requestMIDIAccess();
    midiAccessRef.current = access;
    setHasAccess(true);
    access.onstatechange = () => refreshOutputs();
    refreshOutputs();
  }, [isSupported, refreshOutputs]);

  const selectOutput = useCallback(
    (id: string | null) => {
      if (id === selectedOutputId) {
        return;
      }

      stopAll();
      setSelectedOutputId(id);

      if (!id || !midiAccessRef.current) {
        selectedOutputRef.current = null;
        return;
      }

      selectedOutputRef.current = midiAccessRef.current.outputs.get(id) ?? null;
    },
    [selectedOutputId, stopAll]
  );

  const sendChord = useCallback(
    (root: string, intervals: number[], options: SendChordOptions = {}) => {
      const {
        durationMs = 1500,
        baseOctave = 1,
        velocity = 96,
        playbackMode = 'block',
        arpeggioIntervalMs = 120,
      } = options;

      const output = selectedOutputRef.current;
      if (!output) return;

      const midiNotes = buildMidiChord(root, intervals, baseOctave);
      if (midiNotes.length === 0) return;

      stopAll();

      const releaseDelay = Math.max(50, durationMs);
      const velocityByte = Math.max(1, Math.min(127, Math.round(velocity)));
      const intervalGap = Math.max(10, Math.min(5000, Math.round(arpeggioIntervalMs)));

      if (playbackMode === 'arpeggio') {
        midiNotes.forEach((noteNumber, index) => {
          const startDelay = index * intervalGap;
          const isLastNote = index === midiNotes.length - 1;
          const gapBeforeNext = Math.max(10, intervalGap - 20);
          const perNoteHold = isLastNote
            ? releaseDelay
            : Math.min(releaseDelay, gapBeforeNext);

          const onTimerId = window.setTimeout(() => {
            const currentOutput = selectedOutputRef.current;
            if (!currentOutput) return;

            currentOutput.send([0x90, noteNumber, velocityByte]);
            activeNotesRef.current.push(noteNumber);
          }, startDelay);
          timersRef.current.push(onTimerId);

          const offTimerId = window.setTimeout(() => {
            const currentOutput = selectedOutputRef.current;
            if (!currentOutput) return;

            currentOutput.send([0x80, noteNumber, 0]);
            activeNotesRef.current = activeNotesRef.current.filter(n => n !== noteNumber);
          }, startDelay + perNoteHold);
          timersRef.current.push(offTimerId);
        });
      } else {
        midiNotes.forEach(noteNumber => {
          output.send([0x90, noteNumber, velocityByte]);
        });

        activeNotesRef.current = midiNotes.slice();
        const timerId = window.setTimeout(() => {
          if (!selectedOutputRef.current) return;
          midiNotes.forEach(noteNumber => {
            selectedOutputRef.current?.send([0x80, noteNumber, 0]);
          });
          activeNotesRef.current = [];
        }, releaseDelay);

        timersRef.current.push(timerId);
      }
    },
    [stopAll]
  );

  return {
    isSupported,
    hasAccess,
    outputs,
    selectedOutputId,
    requestAccess,
    selectOutput,
    sendChord,
    stopAll,
  };
};
