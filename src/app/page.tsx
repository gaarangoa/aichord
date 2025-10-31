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
    () => initialSessionRef.current?.chordNotebook ?? []
  );
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
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [selectedChordIndices, setSelectedChordIndices] = useState<Set<number>>(new Set());
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
      const hydratedNotebook = (payload.chordNotebook ?? []).map(entry => ({
        ...entry,
        chord: { ...entry.chord },
        noteSequence: entry.noteSequence ? entry.noteSequence.map(note => ({ ...note })) : undefined,
      }));

      setMessages(hydratedMessages);
      setChordNotebook(hydratedNotebook);
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
      setChordNotebook,
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

  // Apply relative velocity adjustment to all notes
  const handleRelativeVelocityChange = useCallback((targetVelocity: number) => {
    const clampedTarget = clampVelocity(targetVelocity);

    setChordNotebook(prev => {
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
  }, [calculateMedianVelocityFromEntries, clampVelocity]);

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
    setChordNotebook(prev => [
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
  }, []);

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

        return {
          note: noteName,
          octave: noteOctave,
          beat: 0,              // All notes start at beat 0 (downbeat)
          duration: 'whole',    // Whole note = 4 beats in 4/4 time
          velocity: velocity,   // MIDI velocity with variance
        };
      });

      return adjustNotesToTargetVelocity(noteSequence, relativeVelocity);
    };

    setChordNotebook(prev => [
      ...prev,
      {
        entryId: createId(),
        chord,
        addedAt: Date.now(),
        measures: 1, // Default 1 measure (4 beats in 4/4 time)
        noteSequence: generateNoteSequence(chord),
      },
    ]);
  }, [relativeVelocity, adjustNotesToTargetVelocity, clampVelocity]);

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
  }, [chordNotebook, bpm, beatsToMs, durationToBeats, octaveTranspose]);

  const handleNotebookRemove = useCallback((entryId: string) => {
    setChordNotebook(prev => prev.filter(entry => entry.entryId !== entryId));
  }, []);

  const handleClearAll = useCallback(() => {
    setChordNotebook([]);
    setEditingChordId(null);
    setExpandedChordId(null);
    setCurrentPlaybackBeat(null);
  }, []);

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

    setChordNotebook(prev => prev.map(entry => {
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
  }, [editChordInput, editMeasuresInput]);

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

    setChordNotebook(prev => {
      const newNotebook = [...prev];
      const draggedItem = newNotebook[draggingChordIndex];
      newNotebook.splice(draggingChordIndex, 1);
      newNotebook.splice(targetIndex, 0, draggedItem);
      return newNotebook;
    });
    setDraggingChordIndex(targetIndex);
  }, [draggingChordIndex]);

  const handleChordDragEnd = useCallback(() => {
    setDraggingChordIndex(null);
  }, []);

  // Selection handlers for pentagram
  const handleSelectionMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Don't start selection if clicking on a button or draggable element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.draggable) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsSelecting(true);
    setSelectionStart({ x, y });
    setSelectionEnd({ x, y });
  }, []);

  const handleSelectionMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSelecting || !selectionStart) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setSelectionEnd({ x, y });
  }, [isSelecting, selectionStart]);

  const handleSelectionMouseUp = useCallback(() => {
    if (!isSelecting || !selectionStart || !selectionEnd) return;

    setIsSelecting(false);

    // Calculate selection bounds
    const left = Math.min(selectionStart.x, selectionEnd.x);
    const right = Math.max(selectionStart.x, selectionEnd.x);
    const top = Math.min(selectionStart.y, selectionEnd.y);
    const bottom = Math.max(selectionStart.y, selectionEnd.y);

    // Calculate which chords fall within the selection
    // Chord labels are positioned at beat * beatSpacing - 10, and are about 30px tall
    const beatSpacing = 30;
    const chordLabelTop = 120 + 32; // Staff height + margin to chord labels area
    const chordLabelHeight = 30;

    let accumulatedBeats = 0;
    const selected = new Set<number>();

    chordNotebook.forEach((entry, index) => {
      // For each note in the entry, check if any label position falls in selection
      if (entry.noteSequence && entry.noteSequence.length > 0) {
        const firstNoteInMeasure = entry.noteSequence[0];
        const labelX = (accumulatedBeats + firstNoteInMeasure.beat) * beatSpacing - 10;
        const labelRight = labelX + 50; // Approximate label width

        // Check if label overlaps with selection box
        if (labelX <= right && labelRight >= left &&
            chordLabelTop <= bottom && (chordLabelTop + chordLabelHeight) >= top) {
          selected.add(index);
        }
      }

      accumulatedBeats += entry.measures * 4;
    });

    setSelectedChordIndices(selected);
  }, [isSelecting, selectionStart, selectionEnd, chordNotebook]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedChordIndices.size === 0) return;

    setChordNotebook(prev => {
      return prev.filter((_, index) => !selectedChordIndices.has(index));
    });

    // Clear selection after deletion
    setSelectedChordIndices(new Set());
    setSelectionStart(null);
    setSelectionEnd(null);
  }, [selectedChordIndices]);

  // Keyboard event listener for Delete key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedChordIndices.size > 0) {
        // Prevent deleting if user is typing in an input field
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }

        e.preventDefault();
        handleDeleteSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedChordIndices, handleDeleteSelected]);

  const handlePlaySequence = useCallback(async () => {
    if (chordNotebook.length === 0) return;

    sequenceAbortRef.current = false;
    setIsPlayingSequence(true);

    // Calculate total beats for the entire progression
    const totalBeats = chordNotebook.reduce((sum, entry) => sum + entry.measures * 4, 0);

    // Start playback animation
    playbackStartTimeRef.current = performance.now();

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

      // Auto-scroll to the playback position
      const musicSheet = musicSheetRef.current;
      if (musicSheet) {
        const beatSpacing = 30; // Must match the beatSpacing in the render
        const scrollTarget = currentBeat * beatSpacing;
        musicSheet.scrollLeft = Math.max(0, scrollTarget - musicSheet.clientWidth / 2);
      }

      playbackAnimationRef.current = requestAnimationFrame(animate);
    };

    playbackAnimationRef.current = requestAnimationFrame(animate);

    for (const entry of chordNotebook) {
      if (sequenceAbortRef.current) break;

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

    setChordNotebook(prev => [
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
  }, [adjustNotesToTargetVelocity, relativeVelocity]);

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

      noteSequence.push({ note, octave, beat, duration, velocity });
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
            <div className="overflow-x-auto" ref={musicSheetRef}>
              <div className="bg-slate-50 p-4 rounded">
                    {(() => {
                      // Build full note data with durations for proper rendering
                      interface FullNoteData {
                        beat: number;
                        note: string;
                        octave: number;
                        chordLabel: string;
                        duration: NoteDuration;
                      }

                      const fullNotes: FullNoteData[] = [];
                      const silences: Array<{ beat: number; measures: number }> = [];
                      let accumulatedBeats = 0;

                      chordNotebook.forEach(entry => {
                        if (entry.isSilence) {
                          // Track silence position
                          silences.push({
                            beat: accumulatedBeats,
                            measures: entry.measures
                          });
                        } else if (entry.noteSequence && entry.noteSequence.length > 0) {
                          entry.noteSequence.forEach(note => {
                            const absoluteBeat = accumulatedBeats + note.beat;
                            const displayOctave = transposeDisplay ? note.octave + octaveTranspose : note.octave;
                            fullNotes.push({
                              beat: absoluteBeat,
                              note: note.note,
                              octave: displayOctave,
                              chordLabel: entry.chord.label,
                              duration: note.duration
                            });
                          });
                        }
                        // Each measure in 4/4 time = 4 beats
                        accumulatedBeats += entry.measures * 4;
                      });

                      // Sort by beat
                      fullNotes.sort((a, b) => a.beat - b.beat);

                      // Map note to staff position (treble clef)
                      // Staff lines from bottom to top: E4, G4, B4, D5, F5
                      // Spaces from bottom to top: F4, A4, C5, E5
                      const FLAT_TO_SHARP: Record<string, string> = {
                        Db: 'C#',
                        Eb: 'D#',
                        Gb: 'F#',
                        Ab: 'G#',
                        Bb: 'A#',
                      };

                      const getNotePosition = (note: string, octave: number): number => {
                        // Map each note to its position on treble staff (for octave 4)
                        // Position 0 = E4 (bottom line), increases going up
                        const notePositions: Record<string, number> = {
                          'C': -2,   // C4 below staff
                          'C#': -2,
                          'D': -1,   // D4 below staff
                          'D#': -1,
                          'E': 0,    // E4 bottom line
                          'F': 1,    // F4 first space
                          'F#': 1,
                          'G': 2,    // G4 second line
                          'G#': 2,
                          'A': 3,    // A4 second space
                          'A#': 3,
                          'B': 4,    // B4 third line
                        };

                        const canonicalNote = note.length > 1
                          ? `${note[0]?.toUpperCase() ?? ''}${note.slice(1)}`
                          : note.toUpperCase();
                        const normalized = notePositions[canonicalNote] !== undefined
                          ? canonicalNote
                          : FLAT_TO_SHARP[canonicalNote] ?? canonicalNote;
                        const basePos = notePositions[normalized] ?? 0;
                        // Adjust for octave (each octave = 7 positions)
                        const octaveOffset = (octave - 4) * 7;
                        return basePos + octaveOffset;
                      };

                      type BeamSegment = {
                        startX: number;
                        startY: number;
                        endX: number;
                        endY: number;
                        beamCount: number;
                        stemUp: boolean;
                        highlight: boolean;
                      };

                      // Staff lines (5 lines)
                      const STAFF_LINE_COUNT = 5;
                      const LINE_SPACING = 10; // pixels between lines
                      const HALF_STEP = LINE_SPACING / 2;
                      const STAFF_BOTTOM_Y = 94;
                      const STAFF_TOP_Y = STAFF_BOTTOM_Y - (STAFF_LINE_COUNT - 1) * LINE_SPACING;
                      const staffLinePositions = Array.from(
                        { length: STAFF_LINE_COUNT },
                        (_, idx) => STAFF_BOTTOM_Y - idx * LINE_SPACING
                      );

                      // Calculate total width and measure boundaries
                      const beatSpacing = 30; // pixels per beat
                      const totalBeats = accumulatedBeats;
                      const totalMeasures = Math.ceil(totalBeats / 4);
                      const totalWidth = Math.max(800, totalMeasures * 4 * beatSpacing + 100);

                      // Calculate measure bar positions (every 4 beats)
                      const measureBars: number[] = [];
                      for (let measure = 1; measure <= totalMeasures; measure++) {
                        measureBars.push(measure * 4);
                      }

                      // Helper function to render note symbol based on duration
                      const STEM_HEIGHT = 40;
                      const STEM_THICKNESS = 2;

                      const getNoteHeadWidth = (duration: NoteDuration): number =>
                        duration === 'whole' ? 16 : 12;

                      const getNoteHeadHeight = (duration: NoteDuration): number =>
                        duration === 'whole' ? 10 : 7;

                      const getBeamLevel = (duration: NoteDuration): number => {
                        switch (duration) {
                          case 'sixteenth':
                            return 2;
                          case 'eighth':
                          case 'dotted-eighth':
                            return 1;
                          default:
                            return 0;
                        }
                      };

                      type NoteGlyphGeometry = {
                        headWidth: number;
                        headHeight: number;
                        headLeft: number;
                        headTop: number;
                        stemLeft: number;
                        stemTop: number;
                        stemBottom: number;
                        centerY: number;
                        stemUp: boolean;
                      };

                      const computeNoteGeometry = (duration: NoteDuration, centerY: number, stemUp: boolean): NoteGlyphGeometry => {
                        const headWidth = getNoteHeadWidth(duration);
                        const headHeight = getNoteHeadHeight(duration);
                        const headLeft = -headWidth / 2;
                        const headTop = centerY - headHeight / 2;
                        const stemCenterOffset = stemUp ? headWidth / 2 - 0.5 : -headWidth / 2 + 0.5;
                        const stemLeft = stemCenterOffset - STEM_THICKNESS / 2;
                        const stemTop = stemUp ? centerY - STEM_HEIGHT : centerY - 1;
                        const stemBottom = stemTop + STEM_HEIGHT;

                        return {
                          headWidth,
                          headHeight,
                          headLeft,
                          headTop,
                          stemLeft,
                          stemTop,
                          stemBottom,
                          centerY,
                          stemUp,
                        };
                      };

                      const renderNoteSymbol = (
                        duration: NoteDuration,
                        geometry: NoteGlyphGeometry,
                        isPlaying: boolean,
                        options?: { skipFlag?: boolean }
                      ) => {
                        const isFilled = ['quarter', 'eighth', 'sixteenth', 'dotted-quarter', 'dotted-eighth'].includes(duration);
                        const hasFlag = ['eighth', 'sixteenth', 'dotted-eighth'].includes(duration);
                        const hasStem = duration !== 'whole';
                        const hasDot = duration.startsWith('dotted-');
                        const skipFlag = options?.skipFlag ?? false;
                        const { headWidth, headHeight, headLeft, headTop, stemLeft, stemTop, stemBottom, centerY, stemUp } = geometry;

                        const playColor = '#ef4444';
                        const normalColor = '#111827';
                        const noteColor = isPlaying ? playColor : normalColor;
                        const accentColor = isPlaying ? '#fb7185' : '#334155';
                        const fillAccent = isPlaying ? '#fda4af' : '#64748b';
                        const fillColor = isFilled
                          ? `linear-gradient(145deg, ${noteColor} 0%, ${fillAccent} 65%, ${noteColor} 98%)`
                          : `linear-gradient(145deg, rgba(255,255,255,0.98) 5%, rgba(226,232,240,0.75) 60%, rgba(255,255,255,0.95) 95%)`;
                        const borderWidth = duration === 'whole' ? 1.8 : 1.6;
                        const headShadow = isPlaying
                          ? '0 0 10px rgba(239, 68, 68, 0.35)'
                          : isFilled
                            ? '0 1px 2px rgba(15, 23, 42, 0.45), inset -0.5px -0.5px 0 rgba(255, 255, 255, 0.35)'
                            : '0 1px 2px rgba(15, 23, 42, 0.32), inset -0.8px -0.8px 0 rgba(148, 163, 184, 0.45)';

                        return (
                          <>
                            <div
                              className={`absolute transition-transform ${isPlaying ? 'scale-105' : ''}`}
                              style={{
                                top: `${headTop}px`,
                                left: `${headLeft}px`,
                                width: `${headWidth}px`,
                                height: `${headHeight}px`,
                                background: fillColor,
                                border: `${borderWidth}px solid ${noteColor}`,
                                borderRadius: '50% / 58%',
                                transform: 'rotate(-18deg) scaleX(1.04)',
                                boxShadow: headShadow,
                                willChange: 'transform',
                              }}
                            />

                            {hasStem && (
                              <div
                                className="absolute"
                                style={{
                                  top: `${stemTop}px`,
                                  left: `${stemLeft}px`,
                                  width: `${STEM_THICKNESS}px`,
                                  height: `${STEM_HEIGHT}px`,
                                  background: `linear-gradient(to bottom, ${noteColor} 0%, ${isPlaying ? '#b91c1c' : '#0f172a'} 100%)`,
                                  borderRadius: STEM_THICKNESS,
                                  boxShadow: isPlaying ? '0 0 6px rgba(239, 68, 68, 0.35)' : '0 1px 1px rgba(15, 23, 42, 0.4)',
                                }}
                              />
                            )}

                            {hasFlag && !skipFlag && (
                              <div
                                className="absolute"
                                style={{
                                  top: stemUp ? `${stemTop - 4}px` : `${stemBottom - 10}px`,
                                  left: stemUp ? `${stemLeft + STEM_THICKNESS - 0.5}px` : `${stemLeft - 6}px`,
                                  width: '14px',
                                  height: '12px',
                                  background: `linear-gradient(125deg, ${noteColor} 0%, ${accentColor} 60%)`,
                                  borderRadius: stemUp ? '0 12px 12px 12px' : '12px 0 12px 12px',
                                  transform: stemUp ? 'rotate(20deg)' : 'rotate(200deg)',
                                  boxShadow: isPlaying ? '0 0 6px rgba(239, 68, 68, 0.35)' : '0 1px 1px rgba(15, 23, 42, 0.4)',
                                }}
                              />
                            )}

                            {hasDot && (
                              <div
                                className="absolute rounded-full"
                                style={{
                                  top: `${centerY - 2}px`,
                                  left: `${headLeft + headWidth + 6}px`,
                                  width: '5px',
                                  height: '5px',
                                  backgroundColor: noteColor,
                                  boxShadow: '0 0 2px rgba(15, 23, 42, 0.25)',
                                }}
                              />
                            )}
                          </>
                        );
                      };

                      // Show empty state if no chords
                      const beamSegments: BeamSegment[] = [];

                      if (fullNotes.length === 0) {
                        return (
                          <div className="relative" style={{ minWidth: '800px', height: '120px' }}>
                            {/* Staff lines */}
                            <div className="relative" style={{ height: '120px' }}>
                              {staffLinePositions.map((lineY, idx) => (
                                <div
                                  key={idx}
                                  className="absolute border-t border-slate-400"
                                  style={{
                                    top: `${lineY}px`,
                                    left: 0,
                                    width: '100%',
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      }

                      const noteElements = fullNotes.map((note, noteIdx) => {
                        const isPlaying = currentPlaybackBeat !== null &&
                          currentPlaybackBeat >= note.beat &&
                          currentPlaybackBeat < note.beat + durationToBeats(note.duration);

                        const xPosition = note.beat * beatSpacing;
                        const position = getNotePosition(note.note, note.octave);
                        const yPos = STAFF_BOTTOM_Y - position * HALF_STEP;
                        const stemUp = yPos < 74;
                        const geometry = computeNoteGeometry(note.duration, yPos, stemUp);
                        const prevNote = fullNotes[noteIdx - 1];
                        const nextNote = fullNotes[noteIdx + 1];
                        const beamLevel = getBeamLevel(note.duration);
                        const prevBeamLevel = prevNote ? getBeamLevel(prevNote.duration) : 0;
                        const nextBeamLevel = nextNote ? getBeamLevel(nextNote.duration) : 0;
                        const sameMeasurePrev = prevNote ? Math.floor(prevNote.beat / 4) === Math.floor(note.beat / 4) : false;
                        const sameMeasureNext = nextNote ? Math.floor(nextNote.beat / 4) === Math.floor(note.beat / 4) : false;
                        const beamFromPrev = beamLevel > 0 && prevBeamLevel > 0 && sameMeasurePrev;
                        const beamToNext = beamLevel > 0 && nextBeamLevel > 0 && sameMeasureNext;
                        const skipFlag = beamFromPrev || beamToNext;

                        if (beamToNext && nextNote) {
                          const nextPosition = getNotePosition(nextNote.note, nextNote.octave);
                          const nextYPos = STAFF_BOTTOM_Y - nextPosition * HALF_STEP;
                          const nextStemUp = nextYPos < 74;
                          const nextGeometry = computeNoteGeometry(nextNote.duration, nextYPos, nextStemUp);
                          const startStemX = xPosition + geometry.stemLeft + STEM_THICKNESS / 2;
                          const endStemX = nextNote.beat * beatSpacing + nextGeometry.stemLeft + STEM_THICKNESS / 2;
                          const startStemY = geometry.stemUp ? geometry.stemTop + 1 : geometry.stemBottom - 1;
                          const endStemY = nextGeometry.stemUp ? nextGeometry.stemTop + 1 : nextGeometry.stemBottom - 1;
                          const beamStemUp = geometry.stemUp && nextGeometry.stemUp;
                          const beamStemDown = !geometry.stemUp && !nextGeometry.stemUp;
                          const beamOrientation = beamStemUp ? true : beamStemDown ? false : geometry.stemUp;
                          const nextIsPlaying = currentPlaybackBeat !== null &&
                            currentPlaybackBeat >= nextNote.beat &&
                            currentPlaybackBeat < nextNote.beat + durationToBeats(nextNote.duration);

                          beamSegments.push({
                            startX: startStemX,
                            startY: startStemY,
                            endX: endStemX,
                            endY: endStemY,
                            beamCount: Math.min(beamLevel, nextBeamLevel),
                            stemUp: beamOrientation,
                            highlight: isPlaying || nextIsPlaying,
                          });
                        }

                        return (
                          <div key={noteIdx} className="absolute" style={{ left: `${xPosition}px` }} data-note-beat={note.beat}>
                            {renderNoteSymbol(note.duration, geometry, isPlaying, { skipFlag })}

                            {/* Ledger lines for notes outside staff */}
                            {yPos < STAFF_TOP_Y &&
                              Array.from(
                                { length: Math.ceil((STAFF_TOP_Y - yPos) / LINE_SPACING) },
                                (_, i) => (
                                  <div
                                    key={`ledger-above-${i}`}
                                    className="absolute border-t border-slate-400"
                                    style={{
                                      top: `${STAFF_TOP_Y - (i + 1) * LINE_SPACING}px`,
                                      left: '-4px',
                                      width: '20px',
                                    }}
                                  />
                                )
                              )}
                            {yPos > STAFF_BOTTOM_Y &&
                              Array.from(
                                { length: Math.ceil((yPos - STAFF_BOTTOM_Y) / LINE_SPACING) },
                                (_, i) => (
                                  <div
                                    key={`ledger-below-${i}`}
                                    className="absolute border-t border-slate-400"
                                    style={{
                                      top: `${STAFF_BOTTOM_Y + (i + 1) * LINE_SPACING}px`,
                                      left: '-4px',
                                      width: '20px',
                                    }}
                                  />
                                )
                              )}
                          </div>
                        );
                      });

                      const beamElements = beamSegments.flatMap((beam, idx) => {
                        const dx = beam.endX - beam.startX;
                        const dy = beam.endY - beam.startY;
                        const length = Math.max(Math.hypot(dx, dy), 6);
                        const angleRad = Math.atan2(dy, dx);
                        const gradient = beam.highlight
                          ? 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
                          : 'linear-gradient(90deg, #1f2937 0%, #0f172a 100%)';

                        return Array.from({ length: beam.beamCount }).map((_, layerIdx) => {
                          const offset = layerIdx * 6;
                          const direction = beam.stemUp ? 1 : -1;
                          const offsetX = -Math.sin(angleRad) * offset * direction;
                          const offsetY = Math.cos(angleRad) * offset * direction;

                          return (
                            <div
                              key={`beam-${idx}-${layerIdx}`}
                              className="absolute rounded-full"
                              style={{
                                left: `${beam.startX + offsetX}px`,
                                top: `${beam.startY + offsetY}px`,
                                width: `${length}px`,
                                height: '4px',
                                background: gradient,
                                transformOrigin: 'left center',
                                transform: `rotate(${angleRad}rad)`,
                                boxShadow: beam.highlight ? '0 0 10px rgba(239, 68, 68, 0.35)' : '0 1px 2px rgba(15, 23, 42, 0.45)',
                                pointerEvents: 'none',
                              }}
                            />
                          );
                        });
                      });

                      return (
                        <div
                          className="relative"
                          style={{ minWidth: `${totalWidth}px` }}
                          onMouseDown={handleSelectionMouseDown}
                          onMouseMove={handleSelectionMouseMove}
                          onMouseUp={handleSelectionMouseUp}
                          onMouseLeave={handleSelectionMouseUp}
                        >
                          {/* Staff lines - extended across all notes */}
                          <div className="relative" style={{ height: '120px' }}>
                            {staffLinePositions.map((lineY, idx) => (
                              <div
                                key={idx}
                                className="absolute border-t border-slate-400"
                                style={{
                                  top: `${lineY}px`,
                                  left: 0,
                                  right: 0,
                                  width: '100%'
                                }}
                              />
                            ))}

                            {/* Measure bar lines */}
                            {measureBars.map((beatPosition, idx) => (
                              <div
                                key={`bar-${idx}`}
                                className="absolute border-l-2 border-slate-600"
                                style={{
                                  top: `${STAFF_TOP_Y}px`,
                                  left: `${beatPosition * beatSpacing}px`,
                                  height: `${STAFF_BOTTOM_Y - STAFF_TOP_Y}px`,
                                }}
                              />
                            ))}

                            {/* Playback position line (hidden) */}
                            {/* {currentPlaybackBeat !== null && (
                              <div
                                className="absolute border-l-4 border-red-500 opacity-70 z-10"
                                style={{
                                  top: '44px',
                                  left: `${currentPlaybackBeat * beatSpacing}px`,
                                  height: '60px',
                                  transition: 'left 0.05s linear',
                                  boxShadow: '0 0 10px rgba(239, 68, 68, 0.5)',
                                }}
                              />
                            )} */}

                            {/* Rest symbols */}
                            {silences.map((silence, idx) => {
                              const xPosition = silence.beat * beatSpacing;
                              const measures = silence.measures;

                              // Whole rest symbol (hanging from 4th line)
                              return (
                                <div
                                  key={`rest-${idx}`}
                                  className="absolute"
                                  style={{ left: `${xPosition + 10}px`, top: '64px' }}
                                >
                                  <div
                                    className="bg-slate-700"
                                    style={{
                                      width: '12px',
                                      height: '6px',
                                      borderRadius: '1px'
                                    }}
                                    title={`${measures} measure rest`}
                                  />
                                  {measures > 1 && (
                                    <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 text-[10px] font-bold text-slate-700">
                                      {measures}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                          {/* Notes */}
                          <div className="absolute top-0 left-0 w-full">
                            {noteElements}
                            {beamElements}
                          </div>

                          {/* Chord labels at the bottom - only show on first note of each measure */}
                          <div className="relative mt-8" style={{ height: '30px', marginLeft: '0px' }}>
                            {(() => {
                              // Track which chords we've already shown in each measure
                              const shownLabels = new Map<number, Set<string>>(); // measure -> set of chord labels
                              const labelsToShow: Array<{ beat: number; label: string }> = [];

                              fullNotes.forEach(note => {
                                const measureNumber = Math.floor(note.beat / 4);

                                if (!shownLabels.has(measureNumber)) {
                                  shownLabels.set(measureNumber, new Set());
                                }

                                const chordsInMeasure = shownLabels.get(measureNumber)!;

                                // Only show this chord label if it hasn't been shown in this measure yet
                                if (!chordsInMeasure.has(note.chordLabel)) {
                                  chordsInMeasure.add(note.chordLabel);
                                  labelsToShow.push({ beat: note.beat, label: note.chordLabel });
                                }
                              });

                              return labelsToShow.map((item, idx) => {
                                // Find the chord entry for this label
                                const chordEntry = chordNotebook.find(entry => entry.chord.label === item.label);
                                const chordIndex = chordNotebook.findIndex(entry => entry.chord.label === item.label);
                                const isDragging = draggingChordIndex === chordIndex;
                                const isRest = chordEntry?.isSilence;
                                const isSelected = selectedChordIndices.has(chordIndex);

                                return (
                                  <div
                                    key={idx}
                                    className={`absolute ${isDragging ? 'opacity-50' : ''} ${isSelected ? 'ring-2 ring-blue-500 rounded' : ''}`}
                                    style={{ left: `${item.beat * beatSpacing - 10}px` }}
                                    draggable={true}
                                    onDragStart={() => handleChordDragStart(chordIndex)}
                                    onDragOver={(e) => handleChordDragOver(e, chordIndex)}
                                    onDragEnd={handleChordDragEnd}
                                  >
                                    {/* Play button dot (not shown for rests) */}
                                    {chordEntry && !isRest && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleNotebookPlay(chordEntry.entryId);
                                        }}
                                        className="absolute -top-3 left-0 w-3 h-3 rounded-full bg-emerald-500 hover:bg-emerald-600 transition-colors shadow-sm hover:scale-110 cursor-grab active:cursor-grabbing"
                                        title="Play chord (drag to reorder)"
                                        style={{ transform: 'translateX(50%)' }}
                                      >
                                        <span className="sr-only">Play</span>
                                      </button>
                                    )}

                                    {/* Chord label */}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (chordEntry) {
                                          setExpandedChordId(chordEntry.entryId === expandedChordId ? null : chordEntry.entryId);
                                        }
                                      }}
                                      className={`text-[10px] font-semibold ${isRest ? 'text-slate-500 italic' : 'text-slate-700'} hover:text-blue-600 hover:underline cursor-grab active:cursor-grabbing transition-colors`}
                                      title="Click to edit, drag to reorder"
                                    >
                                      {item.label}
                                    </button>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>

                          {/* Selection rectangle */}
                          {(isSelecting || selectionStart) && selectionStart && selectionEnd && (() => {
                            const left = Math.min(selectionStart.x, selectionEnd.x);
                            const top = Math.min(selectionStart.y, selectionEnd.y);
                            const width = Math.abs(selectionEnd.x - selectionStart.x);
                            const height = Math.abs(selectionEnd.y - selectionStart.y);

                            return (
                              <div
                                className="absolute pointer-events-none"
                                style={{
                                  left: `${left}px`,
                                  top: `${top}px`,
                                  width: `${width}px`,
                                  height: `${height}px`,
                                  border: '2px dashed #3b82f6',
                                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                  zIndex: 1000,
                                }}
                              />
                            );
                          })()}
                      </div>
                      );
                    })()}
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
                                        setChordNotebook(prev => prev.map(entry =>
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
                                        setChordNotebook(prev => prev.map(entry =>
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
                                        setChordNotebook(prev => prev.map(entry =>
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
                                        setChordNotebook(prev => prev.map(entry =>
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
                                        setChordNotebook(prev => prev.map(entry =>
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
                                          setChordNotebook(prev => prev.map(entry =>
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
                            const newNote: NoteEvent = {
                              note: 'C',
                              octave: 4,
                              beat: 0,
                              duration: 'quarter',
                              velocity: 96
                            };
                            const newSequence = [...expandedEntry.noteSequence!, newNote];
                            setChordNotebook(prev => prev.map(entry =>
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

            {/* Chord Matrix - shown below pentagram when open */}
            <div className={`border-t border-slate-200 bg-white p-4 ${isChordMatrixOpen ? '' : 'hidden'}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-slate-800">Chord Matrix</h3>
                <button
                  type="button"
                  onClick={() => setIsChordMatrixOpen(false)}
                  className="text-slate-500 hover:text-slate-700 text-xl font-bold px-2"
                >
                  ✕
                </button>
              </div>
              <ChordDiagram
                ref={diagramRef}
                onChordTriggered={handleChordTriggered}
                initialControls={diagramControls}
                onControlsChange={handleDiagramControlsChange}
              />
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
