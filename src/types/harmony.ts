import type { ChordTriggerEvent } from '@/components/ChordDiagram';

export type ChatProvider = 'ollama' | 'openai';

export type ChordQuality =
  | 'major'
  | 'minor'
  | 'dominant7'
  | 'major7'
  | 'minor7'
  | 'halfDiminished7'
  | 'diminished7'
  | 'dominant9'
  | 'major9'
  | 'minor9'
  | 'dominant11'
  | 'major11'
  | 'minor11'
  | 'dominant13'
  | 'major13'
  | 'minor13'
  | 'augmented'
  | 'diminished'
  | 'sus2'
  | 'sus4'
  | 'add9'
  | 'add11';

export type ChatMessageVariant = 'default' | 'chords';

export interface ProviderModelOption {
  id: string;
  label: string;
}

export interface ChatProviderOption {
  id: ChatProvider;
  label: string;
  available: boolean;
  models: ProviderModelOption[];
  error?: string;
}

export interface ProvidersResponse {
  providers: ChatProviderOption[];
}

export interface AgentProfile {
  id: string;
  label: string;
  prompt: string;
}

export interface AgentsResponse {
  agents: AgentProfile[];
  createdId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  chord?: ChordTriggerEvent;
  timestamp: number;
  variant?: ChatMessageVariant;
  tokens?: number; // Token count for this message
}

export type NoteDuration =
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | 'sixteenth'
  | 'dotted-half'
  | 'dotted-quarter'
  | 'dotted-eighth';

export interface NoteEvent {
  note: string;        // Note name (C, D#, E, etc.)
  octave: number;      // Octave number (2-6)
  beat: number;        // Beat number when note starts (0, 1, 2, 3...)
  duration: NoteDuration; // Musical duration
  velocity: number;    // MIDI velocity (1-127, default 96)
}

export interface ChordNotebookEntry {
  entryId: string;
  chord: ChordTriggerEvent;
  addedAt: number;
  measures: number;        // Number of measures/bars this chord spans
  noteSequence?: NoteEvent[]; // Detailed note sequence
  isSilence?: boolean;     // True if this is a rest/silence
}

export interface ParsedChord {
  name: string;
  measures: number;
  noteSequence: NoteEvent[];
}
