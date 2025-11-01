'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ForwardRefExoticComponent, ReactNode, RefAttributes } from 'react';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import type { Components as MarkdownComponents } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import type { ChordDiagramHandle, ChordDiagramProps, ChordTriggerEvent } from '@/components/ChordDiagram';
import Sidebar from '@/components/Sidebar';
import SettingsModal from '@/components/SettingsModal';
import ConversationsDrawer from '@/components/ConversationsDrawer';
import VexFlowNotation from '@/components/VexFlowNotation';
import ChordMatrixModal from '@/components/ChordMatrixModal';
import { convertToVexFlow, addRestsToVexFlow } from '@/lib/vexflowConverter';
import {
  deleteSession,
  getAllSessions,
  getSession,
  saveSession,
  type SessionData,
  type SessionRecord,
} from '@/lib/sessionStorage';
import type { ChordPlaybackControls } from '@/types/harmony';

type ChatProvider = 'ollama' | 'openai';
type ChordQuality = 'major' | 'minor' | 'dominant7' | 'major7' | 'minor7';

type ChatMessageVariant = 'default' | 'chords';

interface ProviderModelOption {
  id: string;
  label: string;
}

interface ChatProviderOption {
  id: ChatProvider;
  label: string;
  available: boolean;
  models: ProviderModelOption[];
  error?: string;
}

interface ProvidersResponse {
  providers: ChatProviderOption[];
}

interface AgentProfile {
  id: string;
  label: string;
  prompt: string;
}

interface AgentsResponse {
  agents: AgentProfile[];
  createdId?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  chord?: ChordTriggerEvent;
  timestamp: number;
  variant?: ChatMessageVariant;
  tokens?: number; // Token count for this message
}

type NoteDuration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' |
                     'dotted-half' | 'dotted-quarter' | 'dotted-eighth';

interface NoteEvent {
  id: string;
  note: string;        // Note name (C, D#, E, etc.)
  octave: number;      // Octave number (2-6)
  beat: number;        // Beat number when note starts (0, 1, 2, 3...)
  duration: NoteDuration; // Musical duration
  velocity: number;    // MIDI velocity (1-127, default 96)
}

interface ChordNotebookEntry {
  entryId: string;
  chord: ChordTriggerEvent;
  addedAt: number;
  measures: number;        // Number of measures/bars this chord spans
  noteSequence?: NoteEvent[]; // Detailed note sequence
  isSilence?: boolean;     // True if this is a rest/silence
}

interface SelectedNoteRef {
  entryId: string;
  noteId: string;
  noteIndex: number;
  alphaTabIndex?: number;
}

interface ParsedChord {
  name: string;
  measures: number;
  noteSequence: NoteEvent[];
}

const DEFAULT_PROVIDER: ChatProvider = 'ollama';
const DEFAULT_NOTE_VELOCITY = 96;

const DEFAULT_CHORD_CONTROLS: ChordPlaybackControls = {
  noteDurationSeconds: 4,
  baseOctave: 2,
  velocity: 56,
  velocityVariance: 10,
  arpeggioIntervalMs: 1,
  arpeggioTimingJitterPercent: 10,
  useInternalAudio: true,
};

const VEX_PIXELS_PER_MEASURE = 200;
const VEX_PIXELS_PER_BEAT = VEX_PIXELS_PER_MEASURE / 4;
const VEX_STAFF_LEFT_MARGIN = 10;
const CHORD_LABEL_TRACK_TOP = 160;
const MIN_CHORD_LABEL_WIDTH_PX = 48;

const MARKDOWN_COMPONENTS: MarkdownComponents = {
  p: ({ children }) => <p className="mb-1 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-1 list-disc pl-4 last:mb-0 leading-relaxed">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1 list-decimal pl-4 last:mb-0 leading-relaxed">{children}</ol>,
  li: ({ children }) => <li className="mb-1 last:mb-0">{children}</li>,
  pre: ({ children }) => (
    <pre className="mb-1 overflow-x-auto rounded-lg bg-slate-900 px-3 py-3 text-sm text-slate-100">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }: { className?: string; children?: ReactNode }) => {
    const inline = !className;
    return inline ? (
      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-800" {...props}>
        {children}
      </code>
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a: ({ children, href }) => (
    <a href={href ?? undefined} className="text-blue-600 underline hover:text-blue-500" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

const REASONING_PATTERN = /(?:^|\n)(#{1,6}\s*Reasoning|(?:\*\*|__)Reasoning(?:\*\*|__)?|Reasoning\s*:)/i;

const extractReasoningSection = (text: string): { body: string; reasoning: string | null } => {
  const match = REASONING_PATTERN.exec(text);
  if (!match) {
    return { body: text, reasoning: null };
  }

  const startIndex = match.index + match[0].length;
  const body = text.slice(0, match.index).trimEnd();
  const reasoningRaw = text.slice(startIndex).trim();

  return {
    body,
    reasoning: reasoningRaw.length > 0 ? reasoningRaw : null,
  };
};

const createControlState = (overrides?: Partial<ChordPlaybackControls>): ChordPlaybackControls => ({
  noteDurationSeconds: overrides?.noteDurationSeconds ?? DEFAULT_CHORD_CONTROLS.noteDurationSeconds,
  baseOctave: overrides?.baseOctave ?? DEFAULT_CHORD_CONTROLS.baseOctave,
  velocity: overrides?.velocity ?? DEFAULT_CHORD_CONTROLS.velocity,
  velocityVariance: overrides?.velocityVariance ?? DEFAULT_CHORD_CONTROLS.velocityVariance,
  arpeggioIntervalMs: overrides?.arpeggioIntervalMs ?? DEFAULT_CHORD_CONTROLS.arpeggioIntervalMs,
  arpeggioTimingJitterPercent:
    overrides?.arpeggioTimingJitterPercent ?? DEFAULT_CHORD_CONTROLS.arpeggioTimingJitterPercent,
  useInternalAudio: overrides?.useInternalAudio ?? DEFAULT_CHORD_CONTROLS.useInternalAudio,
});

const controlsEqual = (a: ChordPlaybackControls, b: ChordPlaybackControls): boolean =>
  a.noteDurationSeconds === b.noteDurationSeconds &&
  a.baseOctave === b.baseOctave &&
  a.velocity === b.velocity &&
  a.velocityVariance === b.velocityVariance &&
  a.arpeggioIntervalMs === b.arpeggioIntervalMs &&
  a.arpeggioTimingJitterPercent === b.arpeggioTimingJitterPercent &&
  a.useInternalAudio === b.useInternalAudio;

const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const withNoteId = (note: Omit<NoteEvent, 'id'> & Partial<Pick<NoteEvent, 'id'>>): NoteEvent => ({
  ...note,
  id: note.id ?? createId(),
});

const normalizeNoteSequence = (sequence?: NoteEvent[]): NoteEvent[] | undefined => {
  if (!sequence) return undefined;
  return sequence.map(note => withNoteId(note));
};

const normalizeChordNotebook = (notebook: ChordNotebookEntry[]): ChordNotebookEntry[] =>
  notebook.map(entry => ({
    ...entry,
    noteSequence: normalizeNoteSequence(entry.noteSequence),
  }));

const cloneNotebook = (notebook: ChordNotebookEntry[]): ChordNotebookEntry[] =>
  notebook.map(entry => ({
    ...entry,
    noteSequence: normalizeNoteSequence(entry.noteSequence?.map(note => ({ ...note }))),
  }));

const NOTE_NAME_TO_VALUE: Record<string, number> = {
  'C': 0,
  'C#': 1,
  'Db': 1,
  'D': 2,
  'D#': 3,
  'Eb': 3,
  'E': 4,
  'Fb': 4,
  'E#': 5,
  'F': 5,
  'F#': 6,
  'Gb': 6,
  'G': 7,
  'G#': 8,
  'Ab': 8,
  'A': 9,
  'A#': 10,
  'Bb': 10,
  'B': 11,
  'Cb': 11,
  'B#': 0,
};

const NOTE_NAMES: string[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const DURATION_LABELS: Record<NoteDuration, string> = {
  'sixteenth': '1/16',
  'eighth': '1/8',
  'dotted-eighth': '1/8.',
  'quarter': '1/4',
  'dotted-quarter': '1/4.',
  'half': '1/2',
  'dotted-half': '1/2.',
  'whole': '1',
};

const QUICK_DURATION_BUTTONS: NoteDuration[] = ['eighth', 'quarter', 'half', 'whole'];

const DURATION_ORDER: NoteDuration[] = [
  'sixteenth',
  'eighth',
  'dotted-eighth',
  'quarter',
  'dotted-quarter',
  'half',
  'dotted-half',
  'whole',
];

const normalizeNoteName = (name: string): string => {
  if (NOTE_NAMES.includes(name)) {
    return name;
  }
  const mapped = NOTE_NAME_TO_VALUE[name];
  if (mapped === undefined) {
    return 'C';
  }
  return NOTE_NAMES[mapped % 12];
};

const cloneNoteWithUpdates = (note: NoteEvent, updates: Partial<Omit<NoteEvent, 'id'>>): NoteEvent =>
  withNoteId({ ...note, ...updates, id: note.id });

const createNoteFromTemplate = (template?: NoteEvent): NoteEvent =>
  withNoteId({
    note: template?.note ?? 'C',
    octave: template?.octave ?? 4,
    beat: template?.beat ?? 0,
    duration: template?.duration ?? 'quarter',
    velocity: template?.velocity ?? DEFAULT_NOTE_VELOCITY,
  });

const transposeNote = (note: NoteEvent, semitoneDelta: number): NoteEvent => {
  const baseName = normalizeNoteName(note.note);
  const baseValue = NOTE_NAME_TO_VALUE[baseName] ?? 0;
  const currentMidi = note.octave * 12 + baseValue;
  const targetMidi = Math.min(127, Math.max(0, currentMidi + semitoneDelta));
  const newOctave = Math.floor(targetMidi / 12);
  const newName = NOTE_NAMES[targetMidi % 12];
  return cloneNoteWithUpdates(note, { note: newName, octave: newOctave });
};

const DEFAULT_SESSION_NAME = 'New Session';

const createDefaultMessages = (): ChatMessage[] => [];

const createDefaultSessionData = (): SessionData => ({
  messages: createDefaultMessages(),
  chordNotebook: [],
  chatInstructions: '',
  selectedAgentId: '',
  selectedModel: '',
  selectedProvider: DEFAULT_PROVIDER,
  relativeVelocity: 45,
  bpm: 120,
  octaveTranspose: 0,
  transposeDisplay: false,
  controls: createControlState(),
  ollamaSessionId: createId(),
});

const deriveSessionNameFromMessages = (messages: ChatMessage[]): string | null => {
  const firstUserMessage = messages.find(message => message.role === 'user' && message.content.trim().length > 0);
  if (!firstUserMessage) {
    return null;
  }

  const primaryLine = firstUserMessage.content.trim().split('\n')[0] ?? '';
  if (!primaryLine) {
    return null;
  }

  const trimmed = primaryLine.slice(0, 60);
  return trimmed.length < primaryLine.length ? `${trimmed}…` : trimmed;
};

const isChordPlaybackMessage = (message: ChatMessage): boolean =>
  message.role === 'system' && message.content.startsWith('🎵 Played');


const ChordDiagram = dynamic(
  () => import('@/components/ChordDiagram'),
  { ssr: false }
) as ForwardRefExoticComponent<ChordDiagramProps & RefAttributes<ChordDiagramHandle>>;

export default function Home() {
  const diagramRef = useRef<ChordDiagramHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const userIsAtBottomRef = useRef(true);
  const suppressNotebookAppendRef = useRef(false);
  const initialSessionRef = useRef<SessionData | null>(null);
  if (!initialSessionRef.current) {
    initialSessionRef.current = createDefaultSessionData();
  }
  const [isConfigCollapsed, setIsConfigCollapsed] = useState(true);
  const [providers, setProviders] = useState<ChatProviderOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ChatProvider>(
    (initialSessionRef.current?.selectedProvider as ChatProvider) ?? DEFAULT_PROVIDER
  );
  const [selectedModel, setSelectedModel] = useState(initialSessionRef.current?.selectedModel ?? '');
  const selectedProviderRef = useRef(selectedProvider);
  const selectedModelRef = useRef(selectedModel);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(initialSessionRef.current?.selectedAgentId ?? '');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentPrompt, setNewAgentPrompt] = useState('');
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatInstructions, setChatInstructions] = useState(initialSessionRef.current?.chatInstructions ?? '');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => initialSessionRef.current?.messages ?? createDefaultMessages()
  );
  const [chordNotebook, setChordNotebook] = useState<ChordNotebookEntry[]>(
    () => normalizeChordNotebook(initialSessionRef.current?.chordNotebook ?? [])
  );
  const [undoStack, setUndoStack] = useState<ChordNotebookEntry[][]>([]);
  const [redoStack, setRedoStack] = useState<ChordNotebookEntry[][]>([]);
  const [selectedNote, setSelectedNote] = useState<SelectedNoteRef | null>(null);
  const [diagramControls, setDiagramControls] = useState<ChordPlaybackControls>(() =>
    createControlState(initialSessionRef.current?.controls)
  );
  const [ollamaSessionId, setOllamaSessionId] = useState<string>(
    initialSessionRef.current?.ollamaSessionId ?? createId()
  );
  const [thinkingTick, setThinkingTick] = useState(0);
  const [editingChordId, setEditingChordId] = useState<string | null>(null);
  const [editChordInput, setEditChordInput] = useState('');
  const [editMeasuresInput, setEditMeasuresInput] = useState('1');
  const [isPlayingSequence, setIsPlayingSequence] = useState(false);
  const [expandedChordId, setExpandedChordId] = useState<string | null>(null);
  const [bpm, setBpm] = useState<number>(initialSessionRef.current?.bpm ?? 120); // Beats per minute
  const [currentPlaybackBeat, setCurrentPlaybackBeat] = useState<number | null>(null); // Continuous playback position
  const musicSheetRef = useRef<HTMLDivElement>(null);
  const sequenceAbortRef = useRef<boolean>(false);
  const playbackStartTimeRef = useRef<number | null>(null);
  const playbackAnimationRef = useRef<number | null>(null);
  const [octaveTranspose, setOctaveTranspose] = useState<number>(initialSessionRef.current?.octaveTranspose ?? 0); // Octave transposition (-2 to +2)
  const [transposeDisplay, setTransposeDisplay] = useState<boolean>(initialSessionRef.current?.transposeDisplay ?? false); // If true, also transpose the display (default: transpose sound only)
  const [draggingChordIndex, setDraggingChordIndex] = useState<number | null>(null);
  const [selectedChordIndices, setSelectedChordIndices] = useState<Set<number>>(new Set());
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [relativeVelocity, setRelativeVelocity] = useState<number>(initialSessionRef.current?.relativeVelocity ?? 45); // Target relative velocity (default 45)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChordMatrixOpen, setIsChordMatrixOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string>(DEFAULT_SESSION_NAME);
  const [isConversationsOpen, setIsConversationsOpen] = useState(false);
  const hasCustomSessionNameRef = useRef(false);
  const isHydratingSessionRef = useRef(false);
  const hydrationTimeoutRef = useRef<number | null>(null);
  const sessionMetaRef = useRef<{ createdAt: number; updatedAt: number }>({
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const hasLoadedSessionsRef = useRef(false);
  const sessionInitRef = useRef<Map<string, boolean>>(new Map());
  const chordOverlayRef = useRef<HTMLDivElement | null>(null);
  const chordElementRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const noteElementRefs = useRef<Map<number, SVGElement>>(new Map());
  const additiveSelectionRef = useRef(false);

  const applyNotebookUpdate = useCallback((updater: (prev: ChordNotebookEntry[]) => ChordNotebookEntry[]) => {
    setChordNotebook(prev => {
      const prevSnapshot = cloneNotebook(prev);
      const updated = updater(prev);
      if (updated === prev) {
        return prev;
      }
      const next = normalizeChordNotebook(updated);
      setUndoStack(stack => [...stack, prevSnapshot]);
      setRedoStack([]);
      return next;
    });
  }, []);

  const replaceNotebook = useCallback((nextNotebook: ChordNotebookEntry[], recordHistory: boolean = true) => {
    setChordNotebook(prev => {
      if (recordHistory) {
        const prevSnapshot = cloneNotebook(prev);
        setUndoStack(stack => [...stack, prevSnapshot]);
        setRedoStack([]);
      }
      return normalizeChordNotebook(nextNotebook);
    });
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack(prevUndo => {
      if (prevUndo.length === 0) {
        return prevUndo;
      }

      const previousSnapshot = prevUndo[prevUndo.length - 1];

      setChordNotebook(current => {
        const redoSnapshot = cloneNotebook(current);
        setRedoStack(prevRedo => [...prevRedo, redoSnapshot]);
        return cloneNotebook(previousSnapshot);
      });

      return prevUndo.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack(prevRedo => {
      if (prevRedo.length === 0) {
        return prevRedo;
      }

      const nextSnapshot = prevRedo[prevRedo.length - 1];

      setChordNotebook(current => {
        const undoSnapshot = cloneNotebook(current);
        setUndoStack(prevUndo => [...prevUndo, undoSnapshot]);
        return cloneNotebook(nextSnapshot);
      });

      return prevRedo.slice(0, -1);
    });
  }, []);

  if (!sessionInitRef.current.has(ollamaSessionId)) {
    const initialMessages = initialSessionRef.current?.messages ?? [];
    const hasHistory = initialMessages.some(message => message.role !== 'system');
    sessionInitRef.current.set(ollamaSessionId, !hasHistory);
  }

  const applySessionData = useCallback(
    (data?: SessionData) => {
      const defaults = createDefaultSessionData();
      const payload = data
        ? {
            ...defaults,
            ...data,
            messages: data.messages && data.messages.length > 0 ? data.messages : defaults.messages,
          }
        : defaults;

      const sanitizedMessages =
        payload.messages?.filter(message => !isChordPlaybackMessage(message)) ?? [];
      const normalizedMessages =
        sanitizedMessages.length > 0 ? sanitizedMessages : createDefaultMessages();

      const hydratedMessages = normalizedMessages.map(message => ({ ...message }));
      const hydratedNotebook = normalizeChordNotebook(
        (payload.chordNotebook ?? []).map(entry => ({
          ...entry,
          chord: { ...entry.chord },
          noteSequence: entry.noteSequence ? entry.noteSequence.map(note => ({ ...note })) : undefined,
        }))
      );

      setMessages(hydratedMessages);
      replaceNotebook(hydratedNotebook, false);
      setChatInstructions(payload.chatInstructions ?? '');
      const candidateProvider = (payload.selectedProvider as ChatProvider) ?? DEFAULT_PROVIDER;
      const safeProvider = candidateProvider === 'openai' || candidateProvider === 'ollama' ? candidateProvider : DEFAULT_PROVIDER;
      setSelectedProvider(safeProvider);
      setSelectedModel(payload.selectedModel ?? '');
      setSelectedAgentId(payload.selectedAgentId ?? '');
      setRelativeVelocity(payload.relativeVelocity ?? defaults.relativeVelocity);
      setBpm(payload.bpm ?? defaults.bpm);
      setOctaveTranspose(payload.octaveTranspose ?? defaults.octaveTranspose);
      setTransposeDisplay(payload.transposeDisplay ?? defaults.transposeDisplay);
      setDiagramControls(createControlState(payload.controls));
      const nextSessionId = payload.ollamaSessionId ?? createId();
      setOllamaSessionId(nextSessionId);
      const hasHistory = hydratedMessages.some(message => message.role !== 'system');
      sessionInitRef.current.set(nextSessionId, !hasHistory);
    },
    [
      setMessages,
      replaceNotebook,
      setChatInstructions,
      setSelectedProvider,
      setSelectedModel,
      setSelectedAgentId,
      setRelativeVelocity,
      setBpm,
      setOctaveTranspose,
      setTransposeDisplay,
      setDiagramControls,
      setOllamaSessionId,
    ]
  );

  const releaseHydrationLock = useCallback(() => {
    if (hydrationTimeoutRef.current !== null) {
      window.clearTimeout(hydrationTimeoutRef.current);
    }
    hydrationTimeoutRef.current = window.setTimeout(() => {
      isHydratingSessionRef.current = false;
      hydrationTimeoutRef.current = null;
    }, 0);
  }, []);

  const loadSession = useCallback(
    (record: SessionRecord) => {
      hasLoadedSessionsRef.current = true;
      isHydratingSessionRef.current = true;
      setActiveSessionId(record.id);
      setSessionName(record.name || DEFAULT_SESSION_NAME);
      hasCustomSessionNameRef.current =
        !!record.name && record.name.trim().length > 0 && record.name !== DEFAULT_SESSION_NAME;
      sessionMetaRef.current = {
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      applySessionData(record.data);
      releaseHydrationLock();
    },
    [applySessionData, releaseHydrationLock]
  );

  const buildBlankSessionData = useCallback((): SessionData => {
    const providerOption = providers.find(option => option.id === selectedProvider);
    const fallbackProvider =
      providerOption ??
      providers.find(option => option.available && option.models.length > 0) ??
      providers[0] ??
      null;
    const providerId =
      (fallbackProvider?.id as ChatProvider | undefined) ?? DEFAULT_PROVIDER;
    const providerModels = fallbackProvider?.models ?? [];
    const modelId =
      (selectedModel && providerModels.some(model => model.id === selectedModel))
        ? selectedModel
        : providerModels[0]?.id ?? '';

    const agentOption = agentProfiles.find(agent => agent.id === selectedAgentId);
    const fallbackAgent = agentOption ?? agentProfiles[0] ?? null;
    const agentId = fallbackAgent?.id ?? '';
    const newSessionId = createId();

    return {
      ...createDefaultSessionData(),
      selectedProvider: providerId,
      selectedModel: modelId,
      selectedAgentId: agentId,
      chatInstructions,
      relativeVelocity,
      bpm,
      octaveTranspose,
      transposeDisplay,
      controls: createControlState(diagramControls),
      ollamaSessionId: newSessionId,
    };
  }, [
    providers,
    selectedProvider,
    selectedModel,
    agentProfiles,
    selectedAgentId,
    chatInstructions,
    relativeVelocity,
    bpm,
    octaveTranspose,
    transposeDisplay,
    diagramControls,
  ]);

  const createAndActivateSession = useCallback((): SessionRecord => {
    const now = Date.now();
    const freshData = buildBlankSessionData();
    const record: SessionRecord = {
      id: createId(),
      name: DEFAULT_SESSION_NAME,
      createdAt: now,
      updatedAt: now,
      data: freshData,
    };

    hasCustomSessionNameRef.current = false;
    setSessionName(DEFAULT_SESSION_NAME);
    sessionMetaRef.current = { createdAt: now, updatedAt: now };
    isHydratingSessionRef.current = true;
    setActiveSessionId(record.id);
    applySessionData(freshData);
    setSessions(prev => {
      if (prev.some(session => session.id === record.id)) {
        return prev;
      }
      return [record, ...prev];
    });
    hasLoadedSessionsRef.current = true;
    releaseHydrationLock();
    return record;
  }, [applySessionData, releaseHydrationLock, buildBlankSessionData]);

  const handleCreateSession = useCallback(() => {
    createAndActivateSession();
    setIsConversationsOpen(false);
  }, [createAndActivateSession]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === activeSessionId) {
        setIsConversationsOpen(false);
        return;
      }

      try {
        const existing = sessions.find(session => session.id === sessionId);
        if (existing) {
          loadSession(existing);
        } else {
          const fetched = await getSession(sessionId);
          if (fetched) {
            setSessions(prev => {
              const others = prev.filter(session => session.id !== fetched.id);
              return [fetched, ...others];
            });
            loadSession(fetched);
          }
        }
      } catch (error) {
        console.error('Failed to load conversation', error);
      } finally {
        setIsConversationsOpen(false);
      }
    },
    [activeSessionId, sessions, loadSession]
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await deleteSession(sessionId);
      } catch (error) {
        console.error('Failed to delete conversation', error);
      }

      const remaining = sessions.filter(session => session.id !== sessionId);
      setSessions(remaining);

      if (activeSessionId === sessionId) {
        if (remaining.length > 0) {
          loadSession(remaining[0]);
        } else {
          createAndActivateSession();
        }
      }
    },
    [activeSessionId, sessions, loadSession, createAndActivateSession]
  );

  const handleClearCurrentSession = useCallback(() => {
    if (!activeSessionId) {
      return;
    }
    const freshData = buildBlankSessionData();
    hasCustomSessionNameRef.current = false;
    setSessionName(DEFAULT_SESSION_NAME);
    isHydratingSessionRef.current = true;
    applySessionData(freshData);
    releaseHydrationLock();
  }, [activeSessionId, applySessionData, releaseHydrationLock, buildBlankSessionData]);

  const handleDiagramControlsChange = useCallback((controls: ChordPlaybackControls) => {
    setDiagramControls(prev => (controlsEqual(prev, controls) ? prev : controls));
  }, []);

  const buildSystemMessages = useCallback((): Array<{ role: 'system'; content: string }> => {
    const trimmedInstructions = chatInstructions.trim();
    const progressionDetails = chordNotebook.map(entry =>
      `${entry.chord.label} (${entry.measures} bar${entry.measures !== 1 ? 's' : ''})`
    );
    const progressionMessage = progressionDetails.length
      ? `Chord progression: ${progressionDetails.join(' → ')}`
      : 'Chord progression: (none selected yet)';

    const result: Array<{ role: 'system'; content: string }> = [];
    if (trimmedInstructions) {
      result.push({ role: 'system', content: `Instructions: ${trimmedInstructions}` });
    }
    result.push({ role: 'system', content: progressionMessage });
    if (agentPrompt.trim()) {
      result.push({ role: 'system', content: agentPrompt.trim() });
    }
    return result;
  }, [agentPrompt, chatInstructions, chordNotebook]);

  const streamAgentResponse = useCallback(
    async (userContent: string, assistantMessageId: string, conversationHistory: ChatMessage[]) => {
      const agent = agentProfiles.find(profile => profile.id === selectedAgentId) ?? null;
      if (!selectedModel || !agent || !agentPrompt) {
        throw new Error('Select an agent and model before sending instructions.');
      }

      const systemMessages = buildSystemMessages();
      const historyInitialized = sessionInitRef.current.get(ollamaSessionId) ?? false;
      const needsHistory = !historyInitialized;
      const historyPayload = needsHistory
        ? conversationHistory
            .filter(message => message.role !== 'system')
            .map(message => ({ role: message.role, content: message.content }))
        : undefined;

      setChatError(null);
      setIsSending(true);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: selectedProvider,
          model: selectedModel,
          sessionId: ollamaSessionId,
          systemMessages,
          history: historyPayload,
          message: userContent,
        }),
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        setIsSending(false);
        throw new Error(errorText || 'Failed to get a response from the selected model.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let tokenCount: number | undefined;
      let buffer = '';
      let assistantCreated = false;
      const assistantTimestamp = Date.now();

      const normalizeChunkText = (input: unknown): string => {
        if (!input) return '';
        if (typeof input === 'string') return input;
        if (Array.isArray(input)) {
          return input.map(item => normalizeChunkText(item)).join('');
        }
        if (typeof input === 'object') {
          const record = input as Record<string, unknown>;
          if (typeof record.text === 'string') return record.text;
          if (typeof record.content === 'string') return record.content;
          if (typeof record.message === 'string') return record.message;
        }
        return '';
      };

      const updateAssistantMessage = (content: string, tokens?: number) => {
        const text = content ?? '';
        const shouldForceCreate = tokens !== undefined && assistantCreated;

        setMessages(prev => {
          const index = prev.findIndex(message => message.id === assistantMessageId);

          if (index === -1) {
            if (!shouldForceCreate && text.trim().length === 0) {
              return prev;
            }

            assistantCreated = true;
            return [
              ...prev,
              {
                id: assistantMessageId,
                role: 'assistant',
                content: text,
                timestamp: assistantTimestamp,
                tokens,
              },
            ];
          }

          const next = [...prev];
          const existing = next[index];
          next[index] = {
            ...existing,
            content: text,
            tokens: tokens ?? existing.tokens,
          };
          if (text.trim().length > 0) {
            assistantCreated = true;
          }
          return next;
        });
      };

      const appendChunkText = (input: unknown) => {
        const text = normalizeChunkText(input);
        if (!text) return;
        assistantContent += text;
        updateAssistantMessage(assistantContent);
      };

      const applyFinalText = (input: unknown) => {
        const text = normalizeChunkText(input);
        if (!text) return;
        assistantContent = text;
        updateAssistantMessage(assistantContent);
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const event of events) {
            const line = event.trim();
            if (!line.startsWith('data:')) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;
            let payload: {
              delta?: unknown;
              content?: unknown;
              done?: boolean;
              tokens?: number | null;
              error?: string;
            };
            try {
              payload = JSON.parse(dataStr);
            } catch {
              continue;
            }
            if (payload.error) {
              throw new Error(payload.error);
            }
            if (payload.delta !== undefined) {
              appendChunkText(payload.delta);
            }
            if (payload.done) {
              if (payload.tokens !== undefined && payload.tokens !== null) {
                tokenCount = payload.tokens;
              }
              if (payload.content !== undefined) {
                applyFinalText(payload.content);
              }
            }
          }
        }

        if (buffer.trim()) {
          const lines = buffer.split('\n');
          for (const rawLine of lines) {
            const trimmed = rawLine.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr) continue;
            let payload: {
              delta?: unknown;
              content?: unknown;
              done?: boolean;
              tokens?: number | null;
              error?: string;
            };
            try {
              payload = JSON.parse(dataStr);
            } catch {
              continue;
            }
            if (payload.error) {
              throw new Error(payload.error);
            }
            if (payload.delta !== undefined) {
              appendChunkText(payload.delta);
            }
            if (payload.done) {
              if (payload.tokens !== undefined && payload.tokens !== null) {
                tokenCount = payload.tokens;
              }
              if (payload.content !== undefined) {
                applyFinalText(payload.content);
              }
            }
          }
        }

        updateAssistantMessage(assistantContent, tokenCount);
        sessionInitRef.current.set(ollamaSessionId, true);
        return assistantContent;
      } catch (error) {
        if (assistantCreated || assistantContent.trim().length > 0) {
          setMessages(prev => prev.filter(message => message.id !== assistantMessageId));
        }
        sessionInitRef.current.set(ollamaSessionId, false);
        throw error;
      } finally {
        setIsSending(false);
      }
    },
    [
      selectedModel,
      selectedProvider,
      agentProfiles,
      selectedAgentId,
      agentPrompt,
      ollamaSessionId,
      buildSystemMessages,
      setMessages,
    ]
  );

  const buildSessionRecord = useCallback((): SessionRecord | null => {
    if (!activeSessionId) {
      return null;
    }

    const now = Date.now();
    const trimmedName = sessionName.trim() || DEFAULT_SESSION_NAME;

    const sourceMessages = messages.length > 0 ? messages : createDefaultMessages();
    const sanitizedMessages = sourceMessages.filter(message => !isChordPlaybackMessage(message));
    const finalMessages = sanitizedMessages.length > 0 ? sanitizedMessages : createDefaultMessages();

    const recordData: SessionData = {
      messages: finalMessages.map(message => ({ ...message })),
      chordNotebook: chordNotebook.map(entry => ({
        ...entry,
        chord: { ...entry.chord },
        noteSequence: entry.noteSequence ? entry.noteSequence.map(note => ({ ...note })) : undefined,
      })),
      chatInstructions,
      selectedAgentId,
      selectedModel,
      selectedProvider,
      relativeVelocity,
      bpm,
      octaveTranspose,
      transposeDisplay,
      controls: createControlState(diagramControls),
      ollamaSessionId,
    };

    return {
      id: activeSessionId,
      name: trimmedName,
      createdAt: sessionMetaRef.current.createdAt,
      updatedAt: now,
      data: recordData,
    };
  }, [
    activeSessionId,
    sessionName,
    messages,
    chordNotebook,
    chatInstructions,
    selectedAgentId,
    selectedModel,
    selectedProvider,
    relativeVelocity,
    bpm,
    octaveTranspose,
    transposeDisplay,
    diagramControls,
    ollamaSessionId,
  ]);

  useEffect(() => {
    if (hasLoadedSessionsRef.current) {
      return;
    }

    let cancelled = false;

    (async () => {
      if (hasLoadedSessionsRef.current) return;
      try {
        const stored = await getAllSessions();
        if (cancelled) return;

        if (stored.length > 0) {
          setSessions(stored);
          loadSession(stored[0]);
        } else {
          createAndActivateSession();
        }
      } catch (error) {
        console.error('Failed to load conversations', error);
        if (!cancelled) {
          createAndActivateSession();
        }
      } finally {
        if (!cancelled) {
          hasLoadedSessionsRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [createAndActivateSession, loadSession]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (isHydratingSessionRef.current) return;
    if (hasCustomSessionNameRef.current) return;

    const derived = deriveSessionNameFromMessages(messages);
    if (derived && derived !== sessionName) {
      setSessionName(derived);
    }
  }, [messages, activeSessionId, sessionName]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    if (isHydratingSessionRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const record = buildSessionRecord();
      if (!record) {
        return;
      }
      sessionMetaRef.current.updatedAt = record.updatedAt;
      saveSession(record)
        .then(() => {
          setSessions(prev => {
            const others = prev.filter(session => session.id !== record.id);
            return [record, ...others].sort((a, b) => b.updatedAt - a.updatedAt);
          });
        })
        .catch(error => {
          console.error('Failed to save conversation', error);
        });
    }, 400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeSessionId, buildSessionRecord]);

  const clampVelocity = useCallback((value: number) => Math.max(1, Math.min(127, value)), []);

  const calculateMedian = useCallback((values: number[]): number => {
    if (values.length === 0) return DEFAULT_NOTE_VELOCITY;

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }, []);

  const calculateMedianVelocityFromEntries = useCallback((entries: ChordNotebookEntry[]): number => {
    const velocities: number[] = [];
    entries.forEach(entry => {
      entry.noteSequence?.forEach(note => velocities.push(note.velocity));
    });
    return calculateMedian(velocities);
  }, [calculateMedian]);

  const adjustNotesToTargetVelocity = useCallback((notes: NoteEvent[], targetVelocity: number): NoteEvent[] => {
    if (notes.length === 0) {
      return [];
    }

    const clampedTarget = clampVelocity(targetVelocity);
    const velocities = notes.map(note => note.velocity);
    const median = calculateMedian(velocities);
    const offset = clampedTarget - median;

    return notes.map(note => ({
      ...note,
      velocity: clampVelocity(note.velocity + offset),
    }));
  }, [calculateMedian, clampVelocity]);

  // Convert musical duration to beats
  const durationToBeats = useCallback((duration: NoteDuration): number => {
    const beatMap: Record<NoteDuration, number> = {
      'whole': 4,
      'half': 2,
      'quarter': 1,
      'eighth': 0.5,
      'sixteenth': 0.25,
      'dotted-half': 3,
      'dotted-quarter': 1.5,
      'dotted-eighth': 0.75,
    };
    return beatMap[duration] || 1;
  }, []);

  // Convert beats to milliseconds based on BPM
  const beatsToMs = useCallback((beats: number): number => {
    return (beats / bpm) * 60000;
  }, [bpm]);

  // Calculate median velocity across all notes
  const currentMedianVelocity = useMemo(
    () => calculateMedianVelocityFromEntries(chordNotebook),
    [chordNotebook, calculateMedianVelocityFromEntries]
  );

  const notationState = useMemo(() => {
    type RenderItem = {
      beat: number;
      order: number;
      noteName: string;
      displayOctave: number;
      duration: NoteDuration;
      chordLabel: string;
      link: NoteLink;
      sourceNote: NoteEvent;
      entryId: string;
      noteIndex: number;
    };

    const items: RenderItem[] = [];
    const silences: Array<{ beat: number; measures: number }> = [];
    let accumulatedBeats = 0;

    chordNotebook.forEach(entry => {
      if (entry.isSilence) {
        silences.push({ beat: accumulatedBeats, measures: entry.measures });
      } else if (entry.noteSequence && entry.noteSequence.length > 0) {
        entry.noteSequence.forEach((note, index) => {
          const absoluteBeat = accumulatedBeats + note.beat;
          const displayOctave = transposeDisplay ? note.octave + octaveTranspose : note.octave;
          const order = items.length;

          items.push({
            beat: absoluteBeat,
            order,
            noteName: note.note,
            displayOctave,
            duration: note.duration,
            chordLabel: index === 0 ? entry.chord.label : undefined,
            link: {
              id: note.id,
              entryId: entry.entryId,
              noteIndex: index,
              beat: absoluteBeat,
            },
            sourceNote: note,
            entryId: entry.entryId,
            noteIndex: index,
          });
        });
      }

      accumulatedBeats += entry.measures * 4;
    });

    const sortedItems = [...items].sort((a, b) => {
      if (a.beat === b.beat) {
        return a.order - b.order;
      }
      return a.beat - b.beat;
    });

    const alphaTexNotes = sortedItems.map(item => ({
      beat: item.beat,
      note: item.noteName,
      octave: item.displayOctave,
      duration: item.duration,
      chordLabel: item.chordLabel,
      velocity: item.sourceNote.velocity,
      id: item.link.id,
    }));

    const noteInfoById = new Map<string, { entryId: string; noteIndex: number; note: NoteEvent; absoluteBeat: number }>();

    sortedItems.forEach(item => {
      noteInfoById.set(item.link.id, {
        entryId: item.entryId,
        noteIndex: item.noteIndex,
        note: item.sourceNote,
        absoluteBeat: item.beat,
      });
    });

    const hasContent = alphaTexNotes.length > 0 || silences.length > 0;
    const vexNotesWithoutRests = hasContent ? convertToVexFlow(alphaTexNotes) : [];
    const vexNotes = hasContent ? addRestsToVexFlow(vexNotesWithoutRests) : [];
    const noteIdToVexIndex = new Map<string, number>();

    vexNotes.forEach((note, index) => {
      note.sourceNoteIds?.forEach(id => {
        noteIdToVexIndex.set(id, index);
      });
    });

    return {
      vexNotes,
      noteInfoById,
      hasContent,
      noteIdToVexIndex,
    };
  }, [chordNotebook, transposeDisplay, octaveTranspose]);

  const { vexNotes, noteInfoById, hasContent, noteIdToVexIndex } = notationState;

  const selectedVexNoteIndices = useMemo(() => {
    if (selectedNoteIds.size === 0) {
      return new Set<number>();
    }
    const indices = new Set<number>();
    selectedNoteIds.forEach(id => {
      const index = noteIdToVexIndex.get(id);
      if (index !== undefined) {
        indices.add(index);
      }
    });
    return indices;
  }, [selectedNoteIds, noteIdToVexIndex]);

  const chordLayout = useMemo(() => {
    const positions: Array<{
      index: number;
      startBeat: number;
      widthBeats: number;
      startPx: number;
      centerPx: number;
      widthPx: number;
      label: string;
      isSilence: boolean;
      entryId: string;
    }> = [];

    let accumulatedBeats = 0;

    chordNotebook.forEach((entry, index) => {
      const entryBeats = entry.measures * 4;
      const startBeat = accumulatedBeats;
      const startPx = startBeat * VEX_PIXELS_PER_BEAT;
      const widthPx = Math.max(entryBeats * VEX_PIXELS_PER_BEAT, MIN_CHORD_LABEL_WIDTH_PX);
      const centerPx = startPx + widthPx / 2;

      positions.push({
        index,
        startBeat,
        widthBeats: entryBeats,
        startPx,
        centerPx,
        widthPx,
        label: entry.isSilence
          ? `${entry.measures} ${entry.measures === 1 ? 'bar rest' : 'bars rest'}`
          : entry.chord.label,
        isSilence: Boolean(entry.isSilence),
        entryId: entry.entryId,
      });

      accumulatedBeats += entryBeats;
    });

    const totalBeats = Math.max(accumulatedBeats, 4);
    const measuresCount = Math.ceil(totalBeats / 4) || 1;
    const totalWidth = Math.max(measuresCount * VEX_PIXELS_PER_MEASURE, 600);

    return {
      positions,
      totalWidth,
      pixelsPerBeat: VEX_PIXELS_PER_BEAT,
    };
  }, [chordNotebook]);

  useEffect(() => {
    if (!selectedNote) return;
    const info = noteInfoById.get(selectedNote.noteId);
    if (!info) {
      setSelectedNote(null);
      return;
    }
    if (info.entryId !== selectedNote.entryId || info.noteIndex !== selectedNote.noteIndex) {
      setSelectedNote(prev => (prev ? { ...prev, entryId: info.entryId, noteIndex: info.noteIndex } : prev));
    }
  }, [noteInfoById, selectedNote]);

  const selectedNoteDetails = useMemo(() => {
    if (!selectedNote) return null;
    const info = noteInfoById.get(selectedNote.noteId);
    if (!info) return null;
    const entry = chordNotebook.find(candidate => candidate.entryId === info.entryId);
    if (!entry || !entry.noteSequence) return null;
    const note = entry.noteSequence.find(candidate => candidate.id === selectedNote.noteId);
    if (!note) return null;
    return {
      entry,
      note,
      noteIndex: info.noteIndex,
      absoluteBeat: info.absoluteBeat,
    } as const;
  }, [chordNotebook, noteInfoById, selectedNote]);

  const updateSelectedNote = useCallback((updates: Partial<Omit<NoteEvent, 'id'>>) => {
    if (!selectedNote) return;
    applyNotebookUpdate(prev => {
      const targetIndex = prev.findIndex(entry => entry.entryId === selectedNote.entryId);
      if (targetIndex === -1) {
        return prev;
      }
      const targetEntry = prev[targetIndex];
      if (!targetEntry.noteSequence) {
        return prev;
      }
      const noteIndex = targetEntry.noteSequence.findIndex(note => note.id === selectedNote.noteId);
      if (noteIndex === -1) {
        return prev;
      }
      const nextNotebook = [...prev];
      const nextSequence = [...targetEntry.noteSequence];
      nextSequence[noteIndex] = cloneNoteWithUpdates(nextSequence[noteIndex], updates);
      nextNotebook[targetIndex] = { ...targetEntry, noteSequence: nextSequence };
      return nextNotebook;
    });
  }, [applyNotebookUpdate, selectedNote]);

  const removeSelectedNote = useCallback(() => {
    if (!selectedNote) return;
    applyNotebookUpdate(prev => {
      const entryIndex = prev.findIndex(entry => entry.entryId === selectedNote.entryId);
      if (entryIndex === -1) {
        return prev;
      }
      const entry = prev[entryIndex];
      if (!entry.noteSequence) {
        return prev;
      }
      const newSequence = entry.noteSequence.filter(note => note.id !== selectedNote.noteId);
      if (newSequence.length === entry.noteSequence.length) {
        return prev;
      }
      if (newSequence.length === 0) {
        const next = [...prev];
        next.splice(entryIndex, 1);
        return next;
      }
      const next = [...prev];
      next[entryIndex] = { ...entry, noteSequence: newSequence };
      return next;
    });
    setSelectedNote(null);
  }, [applyNotebookUpdate, selectedNote]);

  const addNoteAfterSelected = useCallback(() => {
    if (!selectedNote) return;
    const info = noteInfoById.get(selectedNote.noteId);
    if (!info) return;
    const newNote = createNoteFromTemplate(info.note);
    applyNotebookUpdate(prev => {
      const next = [...prev];
      const entryIndex = next.findIndex(entry => entry.entryId === info.entryId);
      if (entryIndex === -1) {
        return prev;
      }
      const entry = next[entryIndex];
      if (!entry.noteSequence) {
        return prev;
      }
      const updatedSequence = [...entry.noteSequence];
      updatedSequence.splice(info.noteIndex + 1, 0, newNote);
      next[entryIndex] = { ...entry, noteSequence: updatedSequence };
      return next;
    });
    setSelectedNote({ entryId: info.entryId, noteId: newNote.id, noteIndex: info.noteIndex + 1 });
  }, [applyNotebookUpdate, noteInfoById, selectedNote]);

  const shiftSelectedNote = useCallback((semitones: number) => {
    if (!selectedNoteDetails) return;
    const shifted = transposeNote(selectedNoteDetails.note, semitones);
    updateSelectedNote({ note: shifted.note, octave: shifted.octave });
  }, [selectedNoteDetails, updateSelectedNote]);

  const adjustSelectedNoteBeat = useCallback((delta: number) => {
    if (!selectedNoteDetails) return;
    const nextBeat = Math.max(0, Number((selectedNoteDetails.note.beat + delta).toFixed(2)));
    updateSelectedNote({ beat: nextBeat });
  }, [selectedNoteDetails, updateSelectedNote]);

  const adjustSelectedNoteVelocity = useCallback((delta: number) => {
    if (!selectedNoteDetails) return;
    const nextVelocity = clampVelocity(selectedNoteDetails.note.velocity + delta);
    updateSelectedNote({ velocity: nextVelocity });
  }, [clampVelocity, selectedNoteDetails, updateSelectedNote]);

  const cycleSelectedNoteDuration = useCallback((direction: 1 | -1) => {
    if (!selectedNoteDetails) return;
    const currentIndex = DURATION_ORDER.indexOf(selectedNoteDetails.note.duration);
    if (currentIndex === -1) {
      updateSelectedNote({ duration: 'quarter' });
      return;
    }
    const nextIndex = Math.min(
      DURATION_ORDER.length - 1,
      Math.max(0, currentIndex + direction)
    );
    updateSelectedNote({ duration: DURATION_ORDER[nextIndex] });
  }, [selectedNoteDetails, updateSelectedNote]);

  useEffect(() => {
    const isEditableElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tag = target.tagName;
      return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableElement(event.target)) {
        return;
      }

      const key = event.key;
      const isUndoCombo = (event.metaKey || event.ctrlKey) && !event.altKey;

      if (isUndoCombo && key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (!selectedNoteDetails) {
        return;
      }

      if (key === 'ArrowUp') {
        event.preventDefault();
        shiftSelectedNote(event.shiftKey ? 12 : 1);
        return;
      }

      if (key === 'ArrowDown') {
        event.preventDefault();
        shiftSelectedNote(event.shiftKey ? -12 : -1);
        return;
      }

      if (key === 'ArrowLeft') {
        event.preventDefault();
        adjustSelectedNoteBeat(event.shiftKey ? -1 : -0.25);
        return;
      }

      if (key === 'ArrowRight') {
        event.preventDefault();
        adjustSelectedNoteBeat(event.shiftKey ? 1 : 0.25);
        return;
      }

      if (key === '[') {
        event.preventDefault();
        cycleSelectedNoteDuration(-1);
        return;
      }

      if (key === ']') {
        event.preventDefault();
        cycleSelectedNoteDuration(1);
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        removeSelectedNote();
        return;
      }

      if (key === '+' || key === '=' ) {
        event.preventDefault();
        adjustSelectedNoteVelocity(event.shiftKey ? 10 : 5);
        return;
      }

      if (key === '-' || key === '_') {
        event.preventDefault();
        adjustSelectedNoteVelocity(event.shiftKey ? -10 : -5);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    adjustSelectedNoteBeat,
    adjustSelectedNoteVelocity,
    cycleSelectedNoteDuration,
    handleRedo,
    handleUndo,
    removeSelectedNote,
    selectedNoteDetails,
    shiftSelectedNote,
  ]);

  // Apply relative velocity adjustment to all notes
  const handleRelativeVelocityChange = useCallback((targetVelocity: number) => {
    const clampedTarget = clampVelocity(targetVelocity);

    applyNotebookUpdate(prev => {
      const previousMedian = calculateMedianVelocityFromEntries(prev);
      const offset = clampedTarget - previousMedian;

      if (offset === 0) {
        return prev;
      }

      return prev.map(entry => {
        if (!entry.noteSequence) return entry;

        const adjustedSequence = entry.noteSequence.map(note => ({
          ...note,
          velocity: clampVelocity(note.velocity + offset),
        }));

        return {
          ...entry,
          noteSequence: adjustedSequence,
        };
      });
    });

    setRelativeVelocity(clampedTarget);
  }, [applyNotebookUpdate, calculateMedianVelocityFromEntries, clampVelocity]);


  useEffect(() => {
    const loadProviders = async () => {
      setIsLoadingProviders(true);
      try {
        const response = await fetch('/api/chat/providers', { method: 'GET' });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Failed to load chat providers.');
        }

        const data = (await response.json()) as ProvidersResponse;
        setProviders(data.providers);

        const firstAvailable =
          data.providers.find(option => option.available && option.models.length > 0) ??
          data.providers.find(option => option.models.length > 0) ??
          null;

        const currentProviderOption = data.providers.find(option => option.id === selectedProviderRef.current);

        if (currentProviderOption) {
          const hasCurrentModel = currentProviderOption.models.some(model => model.id === selectedModelRef.current);
          if (!hasCurrentModel) {
            setSelectedModel(currentProviderOption.models[0]?.id ?? '');
          }
        } else if (firstAvailable) {
          setSelectedProvider(firstAvailable.id);
          setSelectedModel(firstAvailable.models[0]?.id ?? '');
        } else {
          setSelectedModel('');
        }

        setProviderError(null);
      } catch (error) {
        setProviders([]);
        setProviderError(error instanceof Error ? error.message : 'Failed to load chat providers.');
        setSelectedModel('');
      } finally {
        setIsLoadingProviders(false);
      }
    };

    loadProviders().catch(() => null);
  }, []);

  useEffect(() => {
    const loadAgents = async () => {
      setIsLoadingAgents(true);
      try {
        const response = await fetch('/api/agents', { method: 'GET' });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || 'Failed to load agent profiles.');
        }

        const data = (await response.json()) as AgentsResponse;
        setAgentProfiles(data.agents);

        if (data.agents.length > 0) {
          setSelectedAgentId(data.agents[0].id);
          setAgentPrompt(data.agents[0].prompt);
        } else {
          setSelectedAgentId('');
          setAgentPrompt('');
        }

        setAgentError(null);
      } catch (error) {
        setAgentProfiles([]);
        setAgentError(error instanceof Error ? error.message : 'Failed to load agent profiles.');
        setSelectedAgentId('');
        setAgentPrompt('');
      } finally {
        setIsLoadingAgents(false);
      }
    };

    loadAgents().catch(() => null);
  }, []);

  // Auto-connect to MIDI and select first device
  useEffect(() => {
    const autoConnectMidi = async () => {
      if (diagramRef.current) {
        try {
          await diagramRef.current.requestMidiAccess();
          const state = diagramRef.current.getMidiState();
          if (state.hasAccess && state.outputs.length > 0 && !state.selectedOutputId) {
            diagramRef.current.selectMidiOutput(state.outputs[0].id);
          }
        } catch (error) {
          console.error('Failed to auto-connect MIDI:', error);
        }
      }
    };

    // Delay to ensure ChordDiagram is mounted
    const timer = setTimeout(autoConnectMidi, 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (providers.length === 0) {
      return;
    }

    const activeProvider = providers.find(option => option.id === selectedProvider);

    if (!activeProvider) {
      setSelectedProvider(providers[0].id);
      setSelectedModel(providers[0].models[0]?.id ?? '');
      return;
    }

    if (activeProvider.models.length === 0) {
      if (selectedModel !== '') {
        setSelectedModel('');
      }
      return;
    }

    const hasSelectedModel = activeProvider.models.some(model => model.id === selectedModel);
    if (!hasSelectedModel) {
      setSelectedModel(activeProvider.models[0].id);
    }
  }, [providers, selectedProvider, selectedModel]);

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentPrompt('');
      return;
    }

    const activeAgent = agentProfiles.find(profile => profile.id === selectedAgentId);
    if (activeAgent) {
      setAgentPrompt(activeAgent.prompt);
    }
  }, [agentProfiles, selectedAgentId]);

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const threshold = 50; // pixels from bottom
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    userIsAtBottomRef.current = isAtBottom;
  }, []);

  useEffect(() => {
    // Only auto-scroll if user is at or near the bottom
    if (userIsAtBottomRef.current && messagesContainerRef.current) {
      // Scroll the container to the bottom, not the whole page
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isSending && userIsAtBottomRef.current && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [isSending]);

  useEffect(() => {
    if (!isSending) {
      setThinkingTick(0);
      return;
    }
    const intervalId = window.setInterval(() => {
      setThinkingTick(prev => (prev + 1) % 3);
    }, 500);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isSending]);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages(prev => [...prev, message]);
  }, []);

  const activeProvider = useMemo(
    () => providers.find(option => option.id === selectedProvider) ?? null,
    [providers, selectedProvider]
  );

  const activeAgent = useMemo(
    () => agentProfiles.find(profile => profile.id === selectedAgentId) ?? null,
    [agentProfiles, selectedAgentId]
  );

  const modelOptions = activeProvider?.models ?? [];
  selectedProviderRef.current = selectedProvider;
  selectedModelRef.current = selectedModel;
  const isSendDisabled =
    isSending || !chatInput.trim() || !selectedModel || !agentPrompt || !activeAgent;

  const handleAddSilence = useCallback((measures: number = 1) => {
    applyNotebookUpdate(prev => [
      ...prev,
      {
        entryId: createId(),
        chord: {
          id: 'rest',
          root: '',
          label: 'Rest',
          type: 'major' as ChordQuality,
        },
        addedAt: Date.now(),
        measures: measures,
        isSilence: true,
      },
    ]);
  }, [applyNotebookUpdate]);

  const handleAddChordToNotebook = useCallback((chord: ChordTriggerEvent) => {
    // Generate note sequence from chord intervals
    const generateNoteSequence = (chordEvent: ChordTriggerEvent): NoteEvent[] | undefined => {
      // Map chord types to intervals (semitones from root)
      const intervalMap: Record<string, number[]> = {
        'major': [0, 4, 7],
        'minor': [0, 3, 7],
        'dominant7': [0, 4, 7, 10],
        'major7': [0, 4, 7, 11],
        'minor7': [0, 3, 7, 10],
        'halfDiminished7': [0, 3, 6, 10],
        'diminished7': [0, 3, 6, 9],
        'dominant9': [0, 4, 7, 10, 14],
        'major9': [0, 4, 7, 11, 14],
        'minor9': [0, 3, 7, 10, 14],
        'dominant11': [0, 4, 7, 10, 14, 17],
        'major11': [0, 4, 7, 11, 14, 17],
        'minor11': [0, 3, 7, 10, 14, 17],
        'dominant13': [0, 4, 7, 10, 14, 17, 21],
        'major13': [0, 4, 7, 11, 14, 17, 21],
        'minor13': [0, 3, 7, 10, 14, 17, 21],
        'augmented': [0, 4, 8],
        'diminished': [0, 3, 6],
        'sus2': [0, 2, 7],
        'sus4': [0, 5, 7],
        'add9': [0, 4, 7, 14],
        'add11': [0, 4, 7, 17],
      };

      const intervals = intervalMap[chordEvent.type];
      if (!intervals) return undefined;

      // Map root note to MIDI number
      const noteToMidi: Record<string, number> = {
        'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
        'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
        'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
      };

      const midiToNote = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

      const rootMidi = noteToMidi[chordEvent.root] ?? 0;
      const baseOctave = 4; // Default to octave 4 (treble clef range)

      // Generate notes as a block chord (all notes at same time)
      // In 4/4 time, a whole note lasts 4 beats (one complete measure)
      const noteSequence: NoteEvent[] = intervals.map(interval => {
        const noteMidi = rootMidi + interval;
        const noteOctave = baseOctave + Math.floor(noteMidi / 12);
        const noteName = midiToNote[noteMidi % 12];

        // Apply velocity variance (±10% by default)
        const baseVelocity = DEFAULT_NOTE_VELOCITY;
        const variancePercent = 10;
        const maxVariance = baseVelocity * (variancePercent / 100);
        const velocityOffset = Math.round((Math.random() * 2 - 1) * maxVariance);
        const velocity = clampVelocity(baseVelocity + velocityOffset);

        return withNoteId({
          note: noteName,
          octave: noteOctave,
          beat: 0,              // All notes start at beat 0 (downbeat)
          duration: 'whole',    // Whole note = 4 beats in 4/4 time
          velocity: velocity,   // MIDI velocity with variance
        });
      });

      return adjustNotesToTargetVelocity(noteSequence, relativeVelocity);
    };

    applyNotebookUpdate(prev => [
      ...prev,
      {
        entryId: createId(),
        chord,
        addedAt: Date.now(),
        measures: 1, // Default 1 measure (4 beats in 4/4 time)
        noteSequence: generateNoteSequence(chord),
      },
    ]);
  }, [applyNotebookUpdate, relativeVelocity, adjustNotesToTargetVelocity, clampVelocity]);

  const handleChordTriggered = useCallback(
    (event: ChordTriggerEvent) => {
      if (suppressNotebookAppendRef.current) {
        suppressNotebookAppendRef.current = false;
        return;
      }

      handleAddChordToNotebook(event);
    },
    [handleAddChordToNotebook]
  );

  const handleAlphaTabNoteSelect = useCallback((selection: AlphaTabNoteSelection) => {
    if (!selection.link) {
      setSelectedNote(null);
      return;
    }
    setSelectedNote({
      entryId: selection.link.entryId,
      noteId: selection.link.id,
      noteIndex: selection.link.noteIndex,
      alphaTabIndex: selection.alphaTabIndex >= 0 ? selection.alphaTabIndex : undefined,
    });
  }, []);

  const handleProviderChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextProvider = event.target.value as ChatProvider;
      setSelectedProvider(nextProvider);

      const nextProviderOption = providers.find(option => option.id === nextProvider);
      if (nextProviderOption?.models.length) {
        setSelectedModel(nextProviderOption.models[0].id);
      } else {
        setSelectedModel('');
      }
    },
    [providers]
  );

  const handleModelChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(event.target.value);
  }, []);

  const handleAgentChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedAgentId(event.target.value);
  }, []);

  const resetAgentForm = useCallback(() => {
    setNewAgentName('');
    setNewAgentPrompt('');
  }, []);

  const handleToggleAgentCreation = useCallback(() => {
    setIsCreatingAgent(prev => {
      const next = !prev;
      if (!next) {
        resetAgentForm();
      } else {
        setAgentError(null);
      }
      return next;
    });
  }, [resetAgentForm]);

  const handleCreateAgentSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!newAgentName.trim() || !newAgentPrompt.trim()) {
        setAgentError('Name and prompt are both required to create a profile.');
        return;
      }

      setIsSavingAgent(true);
      try {
        const response = await fetch('/api/agents', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            label: newAgentName.trim(),
            prompt: newAgentPrompt.trim(),
          }),
        });

        const raw = await response.text();

        if (!response.ok) {
          let message = 'Failed to save the new agent profile.';
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as { error?: string };
              if (parsed.error) {
                message = parsed.error;
              } else {
                message = raw;
              }
            } catch {
              message = raw;
            }
          }
          throw new Error(message);
        }

        const data = JSON.parse(raw) as AgentsResponse;
        setAgentProfiles(data.agents);

        const targetId = data.createdId ?? data.agents[data.agents.length - 1]?.id ?? '';
        setSelectedAgentId(targetId);

        const updated = data.agents.find(agent => agent.id === targetId);
        setAgentPrompt(updated?.prompt ?? '');
        resetAgentForm();
        setIsCreatingAgent(false);
        setAgentError(null);
      } catch (error) {
        setAgentError(error instanceof Error ? error.message : 'Unable to create agent profile.');
      } finally {
        setIsSavingAgent(false);
      }
    },
    [newAgentName, newAgentPrompt, resetAgentForm]
  );

  const handleSendMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmed = chatInput.trim();
      if (!trimmed || isSending) {
        return;
      }

      if (!selectedModel || !activeAgent || !agentPrompt) {
        setChatError('Select an agent and model before sending instructions.');
        return;
      }

      const estimatedTokens = Math.ceil(trimmed.length / 4);

      const userMessage: ChatMessage = {
        id: createId(),
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
        tokens: estimatedTokens,
      };

      const conversationHistory = messages.filter(message => message.role !== 'system');

      appendMessage(userMessage);
      setChatInput('');
      setChatError(null);

      try {
        await streamAgentResponse(trimmed, createId(), conversationHistory);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to reach the selected model.';
        appendMessage({
          id: createId(),
          role: 'system',
          content: `⚠️ ${message}`,
          timestamp: Date.now(),
        });
      }
    },
    [
      activeAgent,
      agentPrompt,
      appendMessage,
      chatInput,
      isSending,
      messages,
      selectedModel,
      streamAgentResponse,
    ]
  );

  const handleSendSessionSummary = useCallback(async () => {
    if (isSending) {
      return;
    }

    if (!selectedModel || !activeAgent || !agentPrompt) {
      setChatError('Select an agent and model before sending instructions.');
      return;
    }

    const briefingMessage: ChatMessage = {
      id: createId(),
      role: 'system',
      content: '📡 Sent session briefing to agent.',
      timestamp: Date.now(),
    };

    const conversationHistory = messages.filter(message => message.role !== 'system');

    appendMessage(briefingMessage);

    try {
      await streamAgentResponse('Summarize the current session so far.', createId(), conversationHistory);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reach the selected model.';
      appendMessage({
        id: createId(),
        role: 'system',
        content: `⚠️ ${message}`,
        timestamp: Date.now(),
      });
    }
  }, [
    activeAgent,
    agentPrompt,
    appendMessage,
    isSending,
    messages,
    selectedModel,
    streamAgentResponse,
  ]);

  const handleNotebookPlay = useCallback(async (entryId: string) => {
    const target = chordNotebook.find(entry => entry.entryId === entryId);
    if (!target) {
      console.warn('Chord entry not found:', entryId);
      return;
    }

    // Skip silences - don't play anything
    if (target.isSilence) {
      console.log('Skipping silence/rest');
      return;
    }

    console.log('Playing chord:', target.chord.label, 'Has note sequence:', !!target.noteSequence, 'Note count:', target.noteSequence?.length || 0);

    suppressNotebookAppendRef.current = true;
    try {
      // If this entry has a note sequence, send it to MIDI only
      if (target.noteSequence && target.noteSequence.length > 0) {
        console.log('Sending note sequence to MIDI via ChordDiagram at BPM:', bpm, 'Octave transpose:', octaveTranspose, 'Transpose display:', transposeDisplay);

        // Convert musical notation to actual timing in seconds
        // Always apply octave transposition to sound
        const timedNotes = target.noteSequence.map(note => ({
          note: note.note,
          octave: note.octave + octaveTranspose,
          startOffset: beatsToMs(note.beat) / 1000, // Convert beats to seconds
          duration: beatsToMs(durationToBeats(note.duration)) / 1000, // Convert duration to seconds
          velocity: note.velocity, // Use per-note velocity
        }));

        // Send all notes together as a sequence
        diagramRef.current?.sendMidiNoteSequence(timedNotes, {
          velocity: 96, // Base velocity (individual note velocities will be used)
          velocityVariancePercent: 0, // No additional variance, use each note's velocity
        });
      } else {
        // Otherwise use the chord diagram's built-in playback
        console.log('Using chord diagram playback for:', target.chord.id);
        await diagramRef.current?.playChordById(target.chord.id);
      }
    } finally {
      suppressNotebookAppendRef.current = false;
    }
  }, [chordNotebook, bpm, beatsToMs, durationToBeats, octaveTranspose, transposeDisplay]);

  const handleNotebookRemove = useCallback((entryId: string) => {
    applyNotebookUpdate(prev => prev.filter(entry => entry.entryId !== entryId));
    setSelectedNote(prev => (prev?.entryId === entryId ? null : prev));
  }, [applyNotebookUpdate]);

  const handleClearAll = useCallback(() => {
    replaceNotebook([]);
    setEditingChordId(null);
    setExpandedChordId(null);
    setCurrentPlaybackBeat(null);
    setSelectedNote(null);
    setSelectedChordIndices(new Set());
    setSelectedNoteIds(new Set());
  }, [replaceNotebook]);

  const handleStartEditChord = useCallback((entry: ChordNotebookEntry) => {
    setEditingChordId(entry.entryId);
    setEditChordInput(entry.chord.label);
    setEditMeasuresInput(entry.measures.toString());
  }, []);

  const handleSaveEditChord = useCallback((entryId: string) => {
    const newLabel = editChordInput.trim();
    if (!newLabel) {
      setEditingChordId(null);
      return;
    }

    const newMeasures = parseFloat(editMeasuresInput);
    const validMeasures = !isNaN(newMeasures) && newMeasures > 0 ? newMeasures : 1;

    applyNotebookUpdate(prev => prev.map(entry => {
      if (entry.entryId === entryId) {
        // Create a new chord object with updated label, id, and measures
        return {
          ...entry,
          chord: {
            ...entry.chord,
            id: newLabel,
            label: newLabel,
          },
          measures: validMeasures,
        };
      }
      return entry;
    }));

    setEditingChordId(null);
    setEditChordInput('');
    setEditMeasuresInput('1');
  }, [applyNotebookUpdate, editChordInput, editMeasuresInput]);

  const handleCancelEditChord = useCallback(() => {
    setEditingChordId(null);
    setEditChordInput('');
    setEditMeasuresInput('1');
  }, []);

  const handleStopSequence = useCallback(() => {
    sequenceAbortRef.current = true;
    setIsPlayingSequence(false);
    setCurrentPlaybackBeat(null);
    playbackStartTimeRef.current = null;
    if (playbackAnimationRef.current !== null) {
      cancelAnimationFrame(playbackAnimationRef.current);
      playbackAnimationRef.current = null;
    }
  }, []);

  const handleChordDragStart = useCallback((index: number) => {
    setDraggingChordIndex(index);
  }, []);

  const handleChordDragOver = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggingChordIndex === null || draggingChordIndex === targetIndex) return;

    applyNotebookUpdate(prev => {
      const newNotebook = [...prev];
      const draggedItem = newNotebook[draggingChordIndex];
      newNotebook.splice(draggingChordIndex, 1);
      newNotebook.splice(targetIndex, 0, draggedItem);
      return newNotebook;
    });
    setDraggingChordIndex(targetIndex);
  }, [applyNotebookUpdate, draggingChordIndex]);

  const handleChordDragEnd = useCallback(() => {
    setDraggingChordIndex(null);
  }, []);

  const handleNoteElementsChange = useCallback((entries: Array<{ index: number; element: SVGElement }>) => {
    const map = new Map<number, SVGElement>();
    entries.forEach(({ index, element }) => {
      map.set(index, element);
    });
    noteElementRefs.current = map;
  }, []);

  const handleSelectionMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = chordOverlayRef.current;
    if (!container) return;

    const target = e.target as HTMLElement;
    if (target.closest('[data-chord-handle]') || target.draggable) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    additiveSelectionRef.current = e.metaKey || e.ctrlKey;
    if (!additiveSelectionRef.current) {
      setSelectedChordIndices(new Set());
      setSelectedNoteIds(new Set());
      setSelectedNote(null);
    }

    setIsSelectingRegion(true);
    setSelectionStart({ x, y });
    setSelectionEnd({ x, y });

    e.preventDefault();
  }, []);

  const handleSelectionMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSelectingRegion || !selectionStart) return;
    const container = chordOverlayRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setSelectionEnd({ x, y });
  }, [isSelectingRegion, selectionStart]);

  const finalizeSelection = useCallback(() => {
    if (!isSelectingRegion) {
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    const container = chordOverlayRef.current;
    if (!container || !selectionStart || !selectionEnd) {
      setIsSelectingRegion(false);
      setSelectionStart(null);
      setSelectionEnd(null);
      additiveSelectionRef.current = false;
      return;
    }

    const minDistance = 3;
    const moved =
      Math.abs(selectionEnd.x - selectionStart.x) > minDistance ||
      Math.abs(selectionEnd.y - selectionStart.y) > minDistance;

    if (!moved) {
      if (!additiveSelectionRef.current) {
        setSelectedChordIndices(new Set());
        setSelectedNoteIds(new Set());
        setSelectedNote(null);
      }
    } else {
      const rect = container.getBoundingClientRect();
      const left = Math.min(selectionStart.x, selectionEnd.x);
      const right = Math.max(selectionStart.x, selectionEnd.x);
      const top = Math.min(selectionStart.y, selectionEnd.y);
      const bottom = Math.max(selectionStart.y, selectionEnd.y);

      setSelectedChordIndices(prev => {
        const next = additiveSelectionRef.current ? new Set(prev) : new Set<number>();
        chordElementRefs.current.forEach((element, index) => {
          if (!element) return;
          const elementRect = element.getBoundingClientRect();
          const elementLeft = elementRect.left - rect.left;
          const elementRight = elementRect.right - rect.left;
          const elementTop = elementRect.top - rect.top;
          const elementBottom = elementRect.bottom - rect.top;

          const overlaps =
            elementLeft <= right &&
            elementRight >= left &&
            elementTop <= bottom &&
            elementBottom >= top;

          if (overlaps) {
            next.add(index);
          }
        });
        return next;
      });

      const nextSelectedNoteIds = additiveSelectionRef.current ? new Set(selectedNoteIds) : new Set<string>();
      const affectedChordIndices = new Set<number>();

      noteElementRefs.current.forEach((element, index) => {
        const vexNote = vexNotes[index];
        if (!element || !vexNote || vexNote.isRest || !vexNote.sourceNoteIds?.length) {
          return;
        }
        const elementRect = element.getBoundingClientRect();
        const elementLeft = elementRect.left - rect.left;
        const elementRight = elementRect.right - rect.left;
        const elementTop = elementRect.top - rect.top;
        const elementBottom = elementRect.bottom - rect.top;

        const overlaps =
          elementLeft <= right &&
          elementRight >= left &&
          elementTop <= bottom &&
          elementBottom >= top;

        if (overlaps) {
          vexNote.sourceNoteIds.forEach(id => nextSelectedNoteIds.add(id));

          // Map this vex note back to the owning chord index
          vexNote.sourceNoteIds.forEach(id => {
            const noteInfo = noteInfoById.get(id);
            if (noteInfo) {
              const chordIndex = chordNotebook.findIndex(entry => entry.entryId === noteInfo.entryId);
              if (chordIndex >= 0) {
                const entry = chordNotebook[chordIndex];
                if (entry.noteSequence && entry.noteSequence.length > 0) {
                  affectedChordIndices.add(chordIndex);
                }
              }
            }
          });
        }
      });

      if (nextSelectedNoteIds.size > 0 && affectedChordIndices.size > 0) {
        setSelectedChordIndices(prev => {
          const next = additiveSelectionRef.current ? new Set(prev) : new Set<number>();
          affectedChordIndices.forEach(index => next.add(index));
          return next;
        });
      }

      setSelectedNoteIds(nextSelectedNoteIds);

      setSelectedNote(null);
    }

    setIsSelectingRegion(false);
    setSelectionStart(null);
    setSelectionEnd(null);
    additiveSelectionRef.current = false;
  }, [isSelectingRegion, selectionStart, selectionEnd, vexNotes, noteInfoById, chordNotebook, selectedNoteIds]);

  const handleSelectionMouseUp = useCallback(() => {
    finalizeSelection();
  }, [finalizeSelection]);

  const handleSelectionMouseLeave = useCallback(() => {
    if (isSelectingRegion) {
      finalizeSelection();
    }
  }, [finalizeSelection, isSelectingRegion]);

  // Handle clicking on chord labels to select/deselect them
  const handleChordClick = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();

    const isAdditive = e.metaKey || e.ctrlKey;

    setSelectedChordIndices(prev => {
      const newSelection = new Set(prev);
      if (isAdditive) {
        // Cmd/Ctrl+click: toggle selection
        if (newSelection.has(index)) {
          newSelection.delete(index);
        } else {
          newSelection.add(index);
        }
      } else {
        // Regular click: select only this one
        newSelection.clear();
        newSelection.add(index);
      }
      return newSelection;
    });

    if (!isAdditive) {
      setSelectedNoteIds(new Set());
      setSelectedNote(null);
    }
  }, []);

  const handleDeleteSelectedChords = useCallback(() => {
    if (selectedChordIndices.size === 0) return;

    applyNotebookUpdate(prev => prev.filter((_, index) => !selectedChordIndices.has(index)));

    // Clear selection after deletion
    setSelectedChordIndices(new Set());
    setSelectionStart(null);
    setSelectionEnd(null);
    setIsSelectingRegion(false);
  }, [applyNotebookUpdate, selectedChordIndices]);

  const handleDeleteSelectedNotes = useCallback(() => {
    if (selectedNoteIds.size === 0) return;

    applyNotebookUpdate(prev => {
      let modified = false;
      const nextNotebook: ChordNotebookEntry[] = [];

      prev.forEach(entry => {
        if (!entry.noteSequence || entry.noteSequence.length === 0) {
          nextNotebook.push(entry);
          return;
        }

        const filteredSequence = entry.noteSequence.filter(note => !selectedNoteIds.has(note.id));
        if (filteredSequence.length === entry.noteSequence.length) {
          nextNotebook.push(entry);
          return;
        }

        modified = true;

        if (filteredSequence.length > 0) {
          nextNotebook.push({ ...entry, noteSequence: filteredSequence });
        }
      });

      if (!modified) {
        return prev;
      }

      return nextNotebook;
    });

    setSelectedNoteIds(new Set());
    setSelectedNote(null);
    setSelectionStart(null);
    setSelectionEnd(null);
    setIsSelectingRegion(false);
  }, [applyNotebookUpdate, selectedNoteIds]);

  // Keyboard event listener for Delete key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedChordIndices.size > 0 || selectedNoteIds.size > 0)) {
        // Prevent deleting if user is typing in an input field
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }

        e.preventDefault();
        handleDeleteSelectedChords();
        handleDeleteSelectedNotes();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedChordIndices, selectedNoteIds, handleDeleteSelectedChords, handleDeleteSelectedNotes]);

  const handlePlaySequence = useCallback(async () => {
    if (chordNotebook.length === 0) return;

    sequenceAbortRef.current = false;
    setIsPlayingSequence(true);

    // Calculate total beats for the entire progression
    const totalBeats = chordNotebook.reduce((sum, entry) => sum + entry.measures * 4, 0);

    // Smooth animation loop for the playback line
    const animate = () => {
      if (sequenceAbortRef.current || playbackStartTimeRef.current === null) {
        setCurrentPlaybackBeat(null);
        return;
      }

      const elapsed = performance.now() - playbackStartTimeRef.current;
      const currentBeat = (elapsed / beatsToMs(1));

      if (currentBeat >= totalBeats) {
        // Playback complete
        setCurrentPlaybackBeat(null);
        return;
      }

      setCurrentPlaybackBeat(currentBeat);

      // Auto-scroll is now handled by VexFlowNotation component

      playbackAnimationRef.current = requestAnimationFrame(animate);
    };

    // Start playback timer and animation RIGHT BEFORE the first note plays
    playbackStartTimeRef.current = performance.now();
    playbackAnimationRef.current = requestAnimationFrame(animate);

    for (const entry of chordNotebook) {
      if (sequenceAbortRef.current) break;

      // Play the note immediately (timer already started)
      await handleNotebookPlay(entry.entryId);

      // Wait for the measure duration (4 beats per measure in 4/4 time)
      const measureBeats = entry.measures * 4;
      const waitTime = beatsToMs(measureBeats);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    setIsPlayingSequence(false);
    setCurrentPlaybackBeat(null);
    playbackStartTimeRef.current = null;
    if (playbackAnimationRef.current !== null) {
      cancelAnimationFrame(playbackAnimationRef.current);
      playbackAnimationRef.current = null;
    }
  }, [chordNotebook, handleNotebookPlay, beatsToMs]);

  const handleAddParsedChord = useCallback((parsedChord: ParsedChord) => {
    const adjustedNoteSequence = parsedChord.noteSequence
      ? adjustNotesToTargetVelocity(parsedChord.noteSequence, relativeVelocity)
      : undefined;

    applyNotebookUpdate(prev => [
      ...prev,
      {
        entryId: createId(),
        chord: {
          id: parsedChord.name,
          root: parsedChord.name.charAt(0),
          label: parsedChord.name,
          type: 'major' as ChordQuality,
        },
        addedAt: Date.now(),
        measures: parsedChord.measures,
        noteSequence: adjustedNoteSequence,
      },
    ]);
  }, [adjustNotesToTargetVelocity, applyNotebookUpdate, relativeVelocity]);

  const parseChordDefinition = useCallback((chordBlock: string): ParsedChord | null => {
    // Parse format:
    // [CHORD: name | measures]
    // Note, Octave, Beat, Duration, Velocity (velocity is optional)
    // ...
    // [/CHORD]

    const headerMatch = chordBlock.match(/\[CHORD:\s*([^|]+)\s*\|\s*([^\]]+)\]/);
    if (!headerMatch) {
      console.warn('Failed to parse chord header from:', chordBlock.substring(0, 100));
      return null;
    }

    const name = headerMatch[1].trim();
    const measures = parseFloat(headerMatch[2].trim());

    if (!name || isNaN(measures)) {
      console.warn('Invalid chord name or measures:', { name, measures });
      return null;
    }

    // Extract note lines between header and [/CHORD]
    const noteLines = chordBlock
      .split('\n')
      .slice(1) // Skip header line
      .filter(line => line.trim() && !line.includes('[/CHORD]'));

    const noteSequence: NoteEvent[] = [];

    const validDurations: NoteDuration[] = [
      'whole', 'half', 'quarter', 'eighth', 'sixteenth',
      'dotted-half', 'dotted-quarter', 'dotted-eighth'
    ];

    for (const line of noteLines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length !== 4 && parts.length !== 5) continue; // 4 or 5 parts (velocity optional)

      const note = parts[0];
      const octave = parseInt(parts[1]);
      const beat = parseFloat(parts[2]);
      const duration = parts[3] as NoteDuration;
      const velocity = parts.length === 5 ? parseInt(parts[4]) : 96; // Default velocity if not provided

      if (!note || isNaN(octave) || isNaN(beat) || !validDurations.includes(duration)) continue;
      if (isNaN(velocity) || velocity < 1 || velocity > 127) continue;

      noteSequence.push(withNoteId({ note, octave, beat, duration, velocity }));
    }

    if (noteSequence.length === 0) {
      console.warn('No valid notes parsed from chord block');
      return null;
    }

    console.log(`Parsed chord: ${name} (${measures} measures) with ${noteSequence.length} notes:`, noteSequence);
    return { name, measures, noteSequence };
  }, []);

  const renderMessageContent = useCallback(
    (content: string, role: ChatMessage['role']) => {
      type Segment = { kind: 'text'; value: string } | { kind: 'chord'; chord: ParsedChord };

      const parseSegments = (input: string): Segment[] => {
        const segments: Segment[] = [];
        if (!input) {
          return segments;
        }
        const regex = /\[CHORD:[^\]]+\][\s\S]*?\[\/CHORD\]/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(input)) !== null) {
          if (match.index > lastIndex) {
            segments.push({ kind: 'text', value: input.substring(lastIndex, match.index) });
          }
          const chord = parseChordDefinition(match[0]);
          if (chord) {
            segments.push({ kind: 'chord', chord });
          }
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < input.length) {
          segments.push({ kind: 'text', value: input.substring(lastIndex) });
        }
        return segments;
      };

      let nodeKey = 0;
      const renderSegments = (segments: Segment[], keyPrefix: string): ReactNode[] =>
        segments
          .map(segment => {
            if (segment.kind === 'chord') {
              return (
                <button
                  key={`${keyPrefix}-chord-${nodeKey++}`}
                  type="button"
                  onClick={() => handleAddParsedChord(segment.chord)}
                  className="mx-1 inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-100"
                  title={`Click to add ${segment.chord.name} to playground`}
                >
                  <span>{segment.chord.name}</span>
                </button>
              );
            }

            const textValue = segment.value;
            if (!textValue || textValue.trim().length === 0) {
              return null;
            }

            return (
              <ReactMarkdown
                key={`${keyPrefix}-md-${nodeKey++}`}
                components={MARKDOWN_COMPONENTS}
                remarkPlugins={[remarkBreaks]}
              >
                {textValue}
              </ReactMarkdown>
            );
          })
          .filter(Boolean) as ReactNode[];

      if (role !== 'assistant') {
        return <>{renderSegments(parseSegments(content), 'msg')}</>;
      }

      let mainText = content;
      let musicText: string | null = null;
      const musicHeadingRegex = /(^|\n)#+\s*music\b/i;
      const musicMatch = musicHeadingRegex.exec(content);
      if (musicMatch) {
        const startIndex = musicMatch.index;
        mainText = content.slice(0, startIndex).trimEnd();
        musicText = content.slice(startIndex).trim();
      }

      const { body: baseBody, reasoning: reasoningRaw } = extractReasoningSection(mainText);
      const baseSegments = parseSegments(baseBody);
      const reasoningText = reasoningRaw?.trim() ?? '';
      const hasReasoning = reasoningText.length > 0;
      const reasoningSegments = hasReasoning ? parseSegments(reasoningText) : parseSegments(content);
      const bodySegments = hasReasoning ? baseSegments : [];
      const musicSegments = musicText ? parseSegments(musicText) : [];

      const bodyNodes = renderSegments(bodySegments, 'body');
      const musicNodes = renderSegments(musicSegments, 'music');
      const reasoningNodes = renderSegments(reasoningSegments, 'reasoning');
      const shouldShowMusic = hasReasoning && musicNodes.length > 0;

      const result: ReactNode[] = [];

      result.push(
        <details key="reasoning-panel" open className="group mb-2 w-full max-w-full text-slate-600">
          <summary className="flex cursor-pointer items-center gap-2 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 outline-none">
            Agent reasoning
            <span className="text-[10px] text-slate-400 group-open:hidden">show</span>
            <span className="hidden text-[10px] text-slate-400 group-open:inline">hide</span>
          </summary>
          <div className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-sm leading-relaxed">
            {reasoningNodes.length > 0 ? reasoningNodes : (
              <p className="text-slate-400 text-xs italic">No reasoning provided.</p>
            )}
          </div>
        </details>
      );

      if (bodyNodes.length > 0) {
        result.push(
          <div key="assistant-body" className="space-y-2">
            {bodyNodes}
          </div>
        );
      }

      if (shouldShowMusic && musicNodes.length > 0) {
        result.push(
          <details key="music-panel" open className="group mt-3 w-full max-w-full text-slate-700">
            <summary className="flex cursor-pointer items-center gap-2 rounded-md bg-slate-200/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 outline-none hover:bg-slate-200">
              Music
              <span className="text-[10px] text-slate-500 group-open:hidden">show</span>
              <span className="hidden text-[10px] text-slate-500 group-open:inline">hide</span>
            </summary>
            <div className="mt-2 rounded-md bg-slate-200/60 px-3 py-2 text-sm leading-relaxed">
              {musicNodes}
            </div>
          </details>
        );
      }

      return <>{result}</>;
    },
    [handleAddParsedChord, parseChordDefinition]
  );
  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <Sidebar
        onConversationsClick={() => setIsConversationsOpen(prev => !prev)}
        onChordMatrixClick={() => setIsChordMatrixOpen(true)}
        onSettingsClick={() => setIsSettingsOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 ml-16 flex flex-col h-screen overflow-hidden">

        {/* Music Sheet - Fixed at top */}
        <section className="bg-white w-full">
          <div className="w-full py-4">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4 px-4">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={sessionName}
                  onChange={event => setSessionName(event.target.value)}
                  onBlur={() => {
                    if (!sessionName.trim()) {
                      setSessionName(DEFAULT_SESSION_NAME);
                      hasCustomSessionNameRef.current = false;
                    } else {
                      hasCustomSessionNameRef.current = true;
                    }
                  }}
                  className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 shadow-sm focus:border-slate-500 focus:outline-none"
                  placeholder="Session name"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleAddSilence(1)}
                  className="rounded-md bg-slate-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-600"
                  title="Add 1 measure rest"
                >
                  + Rest
                </button>
                {isPlayingSequence ? (
                  <button
                    type="button"
                    onClick={handleStopSequence}
                    className="rounded-md bg-red-600 px-5 py-2 text-xs font-semibold text-white transition hover:bg-red-700"
                  >
                    ⏹ Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handlePlaySequence}
                    disabled={chordNotebook.length === 0}
                    className="rounded-md bg-emerald-600 px-5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    ▶ Play
                  </button>
                )}
                {chordNotebook.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="rounded-md bg-slate-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>
            <div className="w-full overflow-x-auto" ref={musicSheetRef}>
              <div className="bg-slate-50 p-4 rounded inline-block min-w-full">
                                          {!hasContent ? (
                        <div className="text-center py-8 text-slate-500">
                          No music to display. Click chords or ask the agent to add music.
                        </div>
                      ) : (
                        <div className="w-full">
                          <div className="w-full">
                            <div
                              className="relative inline-block"
                              style={{ minWidth: `${chordLayout.totalWidth}px` }}
                              ref={(element) => {
                                chordOverlayRef.current = element;
                              }}
                              onMouseDown={handleSelectionMouseDown}
                              onMouseMove={handleSelectionMouseMove}
                              onMouseUp={handleSelectionMouseUp}
                              onMouseLeave={handleSelectionMouseLeave}
                            >
                              <VexFlowNotation
                                notes={vexNotes}
                                currentPlaybackBeat={currentPlaybackBeat}
                                onNoteClick={(noteIndex) => {
                                  const clickedNote = vexNotes[noteIndex];
                                  if (clickedNote && !clickedNote.isRest && diagramRef.current) {
                                    // Convert VexFlow note format to MIDI format
                                    const midiNotes = clickedNote.notes.map((noteKey, idx) => {
                                      // Parse note format like "C/4" or "C#/4"
                                      const match = noteKey.match(/^([A-G][#b]?)\/(\d+)$/);
                                      if (match) {
                                        // Use the velocity from the note data, or default to 96
                                        const velocity = clickedNote.velocities?.[idx] || 96;
                                        return {
                                          note: match[1],
                                          octave: parseInt(match[2], 10) + octaveTranspose,
                                          startOffset: 0,
                                          duration: 1, // 1 second duration for clicked notes
                                          velocity: velocity,
                                        };
                                      }
                                      return null;
                                    }).filter(n => n !== null);

                                    if (midiNotes.length > 0) {
                                      // Use the average velocity as the base velocity
                                      const avgVelocity = Math.round(
                                        midiNotes.reduce((sum, n) => sum + n.velocity, 0) / midiNotes.length
                                      );
                                      diagramRef.current.sendMidiNoteSequence(midiNotes, {
                                        velocity: avgVelocity,
                                        velocityVariancePercent: 0,
                                      });
                                    }
                                  }
                              }}
                              onRenderComplete={() => {
                                console.log('VexFlow render complete');
                              }}
                              selectedNoteIndices={selectedVexNoteIndices}
                              onNoteElementsChange={handleNoteElementsChange}
                            />
                              <div className="pointer-events-none absolute inset-0">
                                {chordLayout.positions.map(position => (
                                  <div
                                    key={position.entryId}
                                    data-chord-handle
                                    ref={(element) => {
                                      if (element) {
                                        chordElementRefs.current.set(position.index, element);
                                      } else {
                                        chordElementRefs.current.delete(position.index);
                                      }
                                    }}
                                    className={`pointer-events-auto absolute flex items-center justify-center rounded-md transition ${
                                      selectedChordIndices.has(position.index)
                                        ? 'border border-blue-300 bg-white/90 px-2 py-1 shadow-sm ring-2 ring-blue-200'
                                        : 'border border-transparent bg-white/60 px-2 py-1'
                                    }`}
                                    style={{
                                      left: `${VEX_STAFF_LEFT_MARGIN + position.startPx}px`,
                                      top: `${CHORD_LABEL_TRACK_TOP}px`,
                                      width: `${position.widthPx}px`,
                                      transform: 'translateY(-50%)',
                                      cursor: 'grab',
                                      visibility: 'hidden',
                                    }}
                                    draggable
                                    onDragStart={(event) => {
                                      event.stopPropagation();
                                      if (event.dataTransfer) {
                                        event.dataTransfer.setData('text/plain', position.entryId);
                                        event.dataTransfer.effectAllowed = 'move';
                                      }
                                      handleChordDragStart(position.index);
                                    }}
                                    onDragOver={(event) => handleChordDragOver(event, position.index)}
                                    onDragEnd={(event) => {
                                      event.stopPropagation();
                                      handleChordDragEnd();
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={(event) => handleChordClick(position.index, event)}
                                      className={`text-[11px] font-semibold ${
                                        chordNotebook[position.index]?.isSilence
                                          ? 'italic text-slate-500'
                                          : 'text-slate-700'
                                      } hover:text-blue-600`}
                                    >
                                      {position.label}
                                    </button>
                                  </div>
                                ))}
                                {isSelectingRegion && selectionStart && selectionEnd && (
                                  <div
                                    className="absolute rounded border border-blue-400 bg-blue-200/20"
                                    style={{
                                      left: `${Math.min(selectionStart.x, selectionEnd.x)}px`,
                                      top: `${Math.min(selectionStart.y, selectionEnd.y)}px`,
                                      width: `${Math.abs(selectionEnd.x - selectionStart.x)}px`,
                                      height: `${Math.abs(selectionEnd.y - selectionStart.y)}px`,
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Tools panel hidden per user request */}
                          {/* Chord boxes hidden - user requested to remove them */}
                          {/* <div className="flex flex-wrap gap-3 mt-4 px-2">
                            {chordNotebook.map((entry, index) => {
                              ...
                            })}
                          </div> */}

                          {/* Note editing panel intentionally hidden */}
                        </div>
                      )}

          </div>

        {/* Chord Edit Panel - appears when a chord name is clicked */}
                {expandedChordId && (() => {
                  const expandedEntry = chordNotebook.find(e => e.entryId === expandedChordId);
                  if (!expandedEntry || !expandedEntry.noteSequence) return null;

                  return (
                    <div className="mt-6 rounded-lg border-2 border-blue-300 bg-blue-50/30 p-4">
                      <div className="mb-4 flex items-center justify-between">
                        <h4 className="text-sm font-bold text-slate-800">Edit Chord</h4>
                        <button
                          type="button"
                          onClick={() => setExpandedChordId(null)}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          ✕ Close
                        </button>
                      </div>

                      {/* Chord Name and Measures */}
                      <div className="mb-4 flex gap-4">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-slate-600">Chord Name</span>
                          <input
                            type="text"
                            value={editingChordId === expandedChordId ? editChordInput : expandedEntry.chord.label}
                            onChange={(e) => {
                              if (editingChordId !== expandedChordId) {
                                handleStartEditChord(expandedEntry);
                              }
                              setEditChordInput(e.target.value);
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-sm w-40"
                            placeholder="e.g. Cmaj7"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-slate-600">Measures</span>
                          <input
                            type="number"
                            min="0.25"
                            max="16"
                            step="0.25"
                            value={editingChordId === expandedChordId ? editMeasuresInput : expandedEntry.measures.toString()}
                            onChange={(e) => {
                              if (editingChordId !== expandedChordId) {
                                handleStartEditChord(expandedEntry);
                              }
                              setEditMeasuresInput(e.target.value);
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-sm w-20"
                          />
                        </label>
                      </div>

                      {/* Notes Table */}
                      <div className="mb-4">
                        <h5 className="mb-2 text-xs font-semibold text-slate-600">Notes</h5>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border border-slate-200 rounded">
                            <thead className="bg-slate-100">
                              <tr>
                                <th className="px-2 py-1 text-left font-semibold text-slate-700">Note</th>
                                <th className="px-2 py-1 text-left font-semibold text-slate-700">Octave</th>
                                <th className="px-2 py-1 text-left font-semibold text-slate-700">Beat</th>
                                <th className="px-2 py-1 text-left font-semibold text-slate-700">Duration</th>
                                <th className="px-2 py-1 text-left font-semibold text-slate-700">Velocity</th>
                                <th className="px-2 py-1 text-left font-semibold text-slate-700">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedEntry.noteSequence.map((note, noteIdx) => (
                                <tr key={noteIdx} className="border-t border-slate-200">
                                  <td className="px-2 py-1">
                                    <select
                                      value={note.note}
                                      onChange={(e) => {
                                        const newSequence = [...expandedEntry.noteSequence!];
                                        newSequence[noteIdx] = { ...note, note: e.target.value };
                                        applyNotebookUpdate(prev => prev.map(entry =>
                                          entry.entryId === expandedChordId
                                            ? { ...entry, noteSequence: newSequence }
                                            : entry
                                        ));
                                      }}
                                      className="rounded border border-slate-300 px-1 py-0.5 text-xs w-full"
                                    >
                                      {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(n => (
                                        <option key={n} value={n}>{n}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-2 py-1">
                                    <input
                                      type="number"
                                      min="2"
                                      max="6"
                                      value={note.octave}
                                      onChange={(e) => {
                                        const newSequence = [...expandedEntry.noteSequence!];
                                        newSequence[noteIdx] = { ...note, octave: parseInt(e.target.value) || 4 };
                                        applyNotebookUpdate(prev => prev.map(entry =>
                                          entry.entryId === expandedChordId
                                            ? { ...entry, noteSequence: newSequence }
                                            : entry
                                        ));
                                      }}
                                      className="rounded border border-slate-300 px-1 py-0.5 text-xs w-12"
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <input
                                      type="number"
                                      min="0"
                                      max="16"
                                      step="0.25"
                                      value={note.beat}
                                      onChange={(e) => {
                                        const newSequence = [...expandedEntry.noteSequence!];
                                        newSequence[noteIdx] = { ...note, beat: parseFloat(e.target.value) || 0 };
                                        applyNotebookUpdate(prev => prev.map(entry =>
                                          entry.entryId === expandedChordId
                                            ? { ...entry, noteSequence: newSequence }
                                            : entry
                                        ));
                                      }}
                                      className="rounded border border-slate-300 px-1 py-0.5 text-xs w-16"
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <select
                                      value={note.duration}
                                      onChange={(e) => {
                                        const newSequence = [...expandedEntry.noteSequence!];
                                        newSequence[noteIdx] = { ...note, duration: e.target.value as NoteDuration };
                                        applyNotebookUpdate(prev => prev.map(entry =>
                                          entry.entryId === expandedChordId
                                            ? { ...entry, noteSequence: newSequence }
                                            : entry
                                        ));
                                      }}
                                      className="rounded border border-slate-300 px-1 py-0.5 text-xs w-full"
                                    >
                                      <option value="whole">whole</option>
                                      <option value="half">half</option>
                                      <option value="quarter">quarter</option>
                                      <option value="eighth">eighth</option>
                                      <option value="sixteenth">sixteenth</option>
                                      <option value="dotted-half">dotted-half</option>
                                      <option value="dotted-quarter">dotted-quarter</option>
                                      <option value="dotted-eighth">dotted-eighth</option>
                                    </select>
                                  </td>
                                  <td className="px-2 py-1">
                                    <input
                                      type="number"
                                      min="1"
                                      max="127"
                                      value={note.velocity}
                                      onChange={(e) => {
                                        const newSequence = [...expandedEntry.noteSequence!];
                                        newSequence[noteIdx] = { ...note, velocity: parseInt(e.target.value) || 96 };
                                        applyNotebookUpdate(prev => prev.map(entry =>
                                          entry.entryId === expandedChordId
                                            ? { ...entry, noteSequence: newSequence }
                                            : entry
                                        ));
                                      }}
                                      className="rounded border border-slate-300 px-1 py-0.5 text-xs w-16"
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newSequence = expandedEntry.noteSequence!.filter((_, idx) => idx !== noteIdx);
                                        if (newSequence.length === 0) {
                                          // If removing last note, remove the entire chord
                                          handleNotebookRemove(expandedChordId);
                                          setExpandedChordId(null);
                                        } else {
                                          applyNotebookUpdate(prev => prev.map(entry =>
                                            entry.entryId === expandedChordId
                                              ? { ...entry, noteSequence: newSequence }
                                              : entry
                                          ));
                                        }
                                      }}
                                      className="text-red-600 hover:text-red-800 text-xs"
                                      title="Remove note"
                                    >
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Add Note Button */}
                        <button
                          type="button"
                          onClick={() => {
                            const newNote: NoteEvent = withNoteId({
                              note: 'C',
                              octave: 4,
                              beat: 0,
                              duration: 'quarter',
                              velocity: 96
                            });
                            const newSequence = [...expandedEntry.noteSequence!, newNote];
                            applyNotebookUpdate(prev => prev.map(entry =>
                              entry.entryId === expandedChordId
                                ? { ...entry, noteSequence: newSequence }
                                : entry
                            ));
                          }}
                          className="mt-2 rounded border border-blue-300 bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200"
                        >
                          + Add Note
                        </button>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            handleNotebookRemove(expandedChordId);
                            setExpandedChordId(null);
                          }}
                          className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                        >
                          Remove Chord
                        </button>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedChordId(null);
                              if (editingChordId === expandedChordId) {
                                handleCancelEditChord();
                              }
                            }}
                            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Close
                          </button>
                          {editingChordId === expandedChordId && (
                            <button
                              type="button"
                              onClick={() => {
                                handleSaveEditChord(expandedChordId);
                                setExpandedChordId(null);
                              }}
                              className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                            >
                              Save Changes
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </section>

          {/* Creative Chat - Fills 100% of remaining screen */}
          <section className={`flex-1 flex flex-col bg-white min-h-0 ${isChordMatrixOpen ? 'hidden' : ''}`}>

            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="flex-1 overflow-y-auto"
            >
              <div className="max-w-3xl mx-auto px-3 py-4 space-y-3.5">
                {messages.map(message => {
                  if (message.role === 'assistant' && message.content.trim().length === 0) {
                    return null;
                  }

                  const isUserMessage = message.role === 'user';
                  const isSystemMessage = message.role === 'system';
                  const renderedContent = renderMessageContent(message.content, message.role);

                  return (
                    <article
                      key={message.id}
                      className={`w-full flex flex-col ${isUserMessage ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={
                          isUserMessage
                            ? 'inline-block max-w-full rounded-2xl bg-slate-50 px-4 py-3 text-slate-900'
                            : `inline-block max-w-full whitespace-pre-line leading-relaxed text-[15px] ${isSystemMessage ? 'text-slate-500 italic' : 'text-slate-900'}`
                        }
                      >
                        {isUserMessage ? (
                          <div className="whitespace-pre-line leading-relaxed text-[15px]">
                            {renderedContent}
                          </div>
                        ) : (
                          renderedContent
                        )}
                      </div>
                      <div
                        className={`mt-1.5 flex w-fit flex-wrap items-center gap-2 pl-2 text-[11px] text-slate-400 ${
                          isUserMessage ? 'self-end' : ''
                        }`}
                      >
                        <span className="capitalize">{message.role}</span>
                        {message.tokens !== undefined && (
                          <span>• {message.tokens.toLocaleString()} tokens</span>
                        )}
                        <span suppressHydrationWarning>
                          • {new Date(message.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </article>
                  );
                })}
                {isSending && (
                  <div className="text-[11px] font-medium text-slate-500" aria-live="polite">
                    Thinking{'.'.repeat(thinkingTick + 1)}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Chat input */}
            <div className="bg-white p-3">
              <div className="max-w-3xl mx-auto">
                <form onSubmit={handleSendMessage} className="flex gap-2.5">
                  <input
                    value={chatInput}
                    onChange={event => setChatInput(event.target.value)}
                    disabled={isSending}
                    placeholder="Message the agent..."
                    className="flex-1 rounded-2xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 focus:border-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 shadow-sm"
                  />
                  <button
                    type="submit"
                    disabled={
                      isSendDisabled ||
                      !activeProvider?.available ||
                      !agentPrompt ||
                      !activeAgent
                    }
                    className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 shadow-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </form>
                {chatError && (
                  <p className="mt-2 text-xs text-rose-600 text-center">{chatError}</p>
                )}
              </div>
            </div>

      </section>
      </main>

      <ConversationsDrawer
        isOpen={isConversationsOpen}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        onClearCurrentSession={handleClearCurrentSession}
      onClose={() => setIsConversationsOpen(false)}
    />

    <ChordMatrixModal
      isOpen={isChordMatrixOpen}
      onClose={() => setIsChordMatrixOpen(false)}
    >
      <ChordDiagram
        ref={diagramRef}
        onChordTriggered={handleChordTriggered}
        initialControls={diagramControls}
        onControlsChange={handleDiagramControlsChange}
      />
    </ChordMatrixModal>

    {/* Modals */}
    <SettingsModal
      isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        diagramRef={diagramRef}
        bpm={bpm}
        onBpmChange={setBpm}
        octaveTranspose={octaveTranspose}
        onOctaveTransposeChange={setOctaveTranspose}
        transposeDisplay={transposeDisplay}
        onTransposeDisplayChange={setTransposeDisplay}
        relativeVelocity={relativeVelocity}
        currentMedianVelocity={currentMedianVelocity}
        onRelativeVelocityChange={handleRelativeVelocityChange}
        providers={providers}
        selectedProvider={selectedProvider}
        onProviderChange={(provider) => {
          setSelectedProvider(provider as ChatProvider);
          const nextProviderOption = providers.find(option => option.id === provider);
          if (nextProviderOption?.models.length) {
            setSelectedModel(nextProviderOption.models[0].id);
          } else {
            setSelectedModel('');
          }
        }}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        agentProfiles={agentProfiles}
        selectedAgentId={selectedAgentId}
        onAgentChange={setSelectedAgentId}
        chatInstructions={chatInstructions}
        onChatInstructionsChange={setChatInstructions}
        isLoadingProviders={isLoadingProviders}
        isLoadingAgents={isLoadingAgents}
        providerError={providerError}
        agentError={agentError}
        isCreatingAgent={isCreatingAgent}
        onToggleAgentCreation={handleToggleAgentCreation}
        newAgentName={newAgentName}
        onNewAgentNameChange={setNewAgentName}
        newAgentPrompt={newAgentPrompt}
        onNewAgentPromptChange={setNewAgentPrompt}
        onCreateAgentSubmit={handleCreateAgentSubmit}
        isSavingAgent={isSavingAgent}
        isSending={isSending}
        onSendSessionSummary={handleSendSessionSummary}
      />
    </div>
  );
}
