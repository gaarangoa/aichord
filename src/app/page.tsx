'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ForwardRefExoticComponent, RefAttributes } from 'react';
import dynamic from 'next/dynamic';
import type { ChordDiagramHandle, ChordDiagramProps, ChordTriggerEvent } from '@/components/ChordDiagram';

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
}

interface ParsedChord {
  name: string;
  measures: number;
  noteSequence: NoteEvent[];
}

const DEFAULT_PROVIDER: ChatProvider = 'ollama';

const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;



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
  const [isConfigCollapsed, setIsConfigCollapsed] = useState(true);
  const [providers, setProviders] = useState<ChatProviderOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ChatProvider>(DEFAULT_PROVIDER);
  const [selectedModel, setSelectedModel] = useState('');
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentPrompt, setNewAgentPrompt] = useState('');
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatInstructions, setChatInstructions] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: createId(),
      role: 'assistant',
      content: "Hi! I'm your harmonic co-pilot. Play chords on the graph and I'll keep track so we can workshop progressions together.",
      timestamp: Date.now(),
    },
  ]);
  const [chordNotebook, setChordNotebook] = useState<ChordNotebookEntry[]>([]);
  const [editingChordId, setEditingChordId] = useState<string | null>(null);
  const [editChordInput, setEditChordInput] = useState('');
  const [editMeasuresInput, setEditMeasuresInput] = useState('1');
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [editNoteData, setEditNoteData] = useState<NoteEvent | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [isPlayingSequence, setIsPlayingSequence] = useState(false);
  const [currentlyPlayingChordId, setCurrentlyPlayingChordId] = useState<string | null>(null);
  const [expandedChordId, setExpandedChordId] = useState<string | null>(null);
  const [bpm, setBpm] = useState<number>(120); // Beats per minute
  const [currentPlayingNoteBeat, setCurrentPlayingNoteBeat] = useState<number | null>(null);
  const [currentPlaybackBeat, setCurrentPlaybackBeat] = useState<number | null>(null); // Continuous playback position
  const musicSheetRef = useRef<HTMLDivElement>(null);
  const sequenceAbortRef = useRef<boolean>(false);
  const playbackStartTimeRef = useRef<number | null>(null);
  const playbackAnimationRef = useRef<number | null>(null);
  const [octaveTranspose, setOctaveTranspose] = useState<number>(0); // Octave transposition (-2 to +2)
  const [transposeDisplay, setTransposeDisplay] = useState<boolean>(false); // If true, also transpose the display (default: transpose sound only)

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

        if (firstAvailable) {
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
    if (userIsAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

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
  const isSendDisabled =
    isSending || !chatInput.trim() || !selectedModel || !agentPrompt || !activeAgent;

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
        const baseVelocity = 96;
        const variancePercent = 10;
        const maxVariance = baseVelocity * (variancePercent / 100);
        const velocityOffset = Math.round((Math.random() * 2 - 1) * maxVariance);
        const velocity = Math.max(1, Math.min(127, baseVelocity + velocityOffset));

        return {
          note: noteName,
          octave: noteOctave,
          beat: 0,              // All notes start at beat 0 (downbeat)
          duration: 'whole',    // Whole note = 4 beats in 4/4 time
          velocity: velocity,   // MIDI velocity with variance
        };
      });

      return noteSequence;
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
  }, []);

  const sendConversationToAgent = useCallback(
    async (conversationMessages: ChatMessage[]) => {
      if (!selectedModel || !activeAgent || !agentPrompt) {
        setChatError('Select an agent and model before sending instructions.');
        return;
      }

      const trimmedInstructions = chatInstructions.trim();
      const progressionDetails = chordNotebook.map(entry =>
        `${entry.chord.label} (${entry.measures} bar${entry.measures !== 1 ? 's' : ''})`
      );
      const progressionMessage = progressionDetails.length
        ? `Chord progression: ${progressionDetails.join(' → ')}`
        : 'Chord progression: (none selected yet)';

      const systemMessages = [
        ...(trimmedInstructions
          ? [{ role: 'system' as const, content: `Instructions: ${trimmedInstructions}` }]
          : []),
        { role: 'system' as const, content: progressionMessage },
        ...(agentPrompt.trim()
          ? [{ role: 'system' as const, content: agentPrompt.trim() }]
          : []),
      ];

      const filteredConversation = conversationMessages.filter(message => message.role !== 'system');

      const payloadMessages = [
        ...systemMessages,
        ...filteredConversation.map(message => ({
          role: message.role,
          content: message.content,
        })),
      ];

      setChatError(null);
      setIsSending(true);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            provider: selectedProvider,
            model: selectedModel,
            messages: payloadMessages,
          }),
        });

        const raw = await response.text();

        if (!response.ok) {
          let errorMessage = 'Failed to get a response from the selected model.';
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as { error?: string };
              if (parsed.error) {
                errorMessage = parsed.error;
              } else {
                errorMessage = raw;
              }
            } catch {
              errorMessage = raw;
            }
          }
          throw new Error(errorMessage);
        }

        if (!raw) {
          throw new Error('The selected model returned an empty response.');
        }

        let assistantContent = '';
        try {
          const data = JSON.parse(raw) as { message?: { content?: string } };
          assistantContent = data.message?.content?.trim() ?? '';
        } catch {
          assistantContent = raw;
        }

        if (!assistantContent) {
          throw new Error('The selected model did not return any content.');
        }

        appendMessage({
          id: createId(),
          role: 'assistant',
          content: assistantContent,
          timestamp: Date.now(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to reach the selected model.';
        setChatError(message);
        appendMessage({
          id: createId(),
          role: 'system',
          content: `⚠️ ${message}`,
          timestamp: Date.now(),
        });
      } finally {
        setIsSending(false);
      }
    },
    [activeAgent, agentPrompt, appendMessage, chatInstructions, chordNotebook, selectedModel, selectedProvider]
  );

  const handleChordTriggered = useCallback((event: ChordTriggerEvent) => {
    const friendlyQuality = event.type.replace(/([A-Z])/g, ' $1').toLowerCase();
    const chordMessage: ChatMessage = {
      id: createId(),
      role: 'system',
      content: `🎵 Played ${event.label} — ${friendlyQuality.trim()}`,
      chord: event,
      timestamp: Date.now(),
    };
    appendMessage(chordMessage);

    if (suppressNotebookAppendRef.current) {
      suppressNotebookAppendRef.current = false;
      return;
    }

    handleAddChordToNotebook(event);
  }, [appendMessage, handleAddChordToNotebook]);

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

      if (!chatInput.trim() || !selectedModel || !agentPrompt || !activeAgent || isSending) {
        return;
      }

      const userText = chatInput.trim();
      const userMessage: ChatMessage = {
        id: createId(),
        role: 'user',
        content: userText,
        timestamp: Date.now(),
      };

      appendMessage(userMessage);
      setChatInput('');
      setChatError(null);
      const updatedMessages = [...messages, userMessage];
      await sendConversationToAgent(updatedMessages);
    },
    [activeAgent, agentPrompt, appendMessage, chatInput, isSending, messages, selectedModel, sendConversationToAgent]
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

    appendMessage(briefingMessage);
    const updatedMessages = [...messages, briefingMessage];
    await sendConversationToAgent(updatedMessages);
  }, [activeAgent, agentPrompt, appendMessage, isSending, messages, selectedModel, sendConversationToAgent]);

  const handleNotebookPlay = useCallback(async (entryId: string) => {
    const target = chordNotebook.find(entry => entry.entryId === entryId);
    if (!target) {
      console.warn('Chord entry not found:', entryId);
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
    setCurrentlyPlayingChordId(null);
    setCurrentPlayingNoteBeat(null);
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

  const handleDragStart = useCallback((index: number) => {
    setDraggingIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex === index) return;

    setChordNotebook(prev => {
      const newNotebook = [...prev];
      const draggedItem = newNotebook[draggingIndex];
      newNotebook.splice(draggingIndex, 1);
      newNotebook.splice(index, 0, draggedItem);
      return newNotebook;
    });
    setDraggingIndex(index);
  }, [draggingIndex]);

  const handleDragEnd = useCallback(() => {
    setDraggingIndex(null);
  }, []);

  const handleStopSequence = useCallback(() => {
    sequenceAbortRef.current = true;
    setIsPlayingSequence(false);
    setCurrentlyPlayingChordId(null);
    setCurrentPlayingNoteBeat(null);
    setCurrentPlaybackBeat(null);
    playbackStartTimeRef.current = null;
    if (playbackAnimationRef.current !== null) {
      cancelAnimationFrame(playbackAnimationRef.current);
      playbackAnimationRef.current = null;
    }
  }, []);

  const handlePlaySequence = useCallback(async () => {
    if (chordNotebook.length === 0) return;

    sequenceAbortRef.current = false;
    setIsPlayingSequence(true);

    // Calculate total beats for the entire progression
    const totalBeats = chordNotebook.reduce((sum, entry) => sum + entry.measures * 4, 0);
    const totalDurationMs = beatsToMs(totalBeats);

    // Start playback animation
    const startTime = performance.now();
    playbackStartTimeRef.current = startTime;

    // Smooth animation loop for the playback line
    const animate = () => {
      if (sequenceAbortRef.current || playbackStartTimeRef.current === null) {
        setCurrentPlaybackBeat(null);
        setCurrentPlayingNoteBeat(null);
        return;
      }

      const elapsed = performance.now() - playbackStartTimeRef.current;
      const currentBeat = (elapsed / beatsToMs(1));

      if (currentBeat >= totalBeats) {
        // Playback complete
        setCurrentPlaybackBeat(null);
        setCurrentPlayingNoteBeat(null);
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

    let accumulatedBeats = 0;

    for (const entry of chordNotebook) {
      if (sequenceAbortRef.current) break;

      setCurrentlyPlayingChordId(entry.entryId);

      await handleNotebookPlay(entry.entryId);

      // Wait for the measure duration (4 beats per measure in 4/4 time)
      const measureBeats = entry.measures * 4;
      const waitTime = beatsToMs(measureBeats);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      accumulatedBeats += measureBeats;
    }

    setIsPlayingSequence(false);
    setCurrentlyPlayingChordId(null);
    setCurrentPlaybackBeat(null);
    setCurrentPlayingNoteBeat(null);
    playbackStartTimeRef.current = null;
    if (playbackAnimationRef.current !== null) {
      cancelAnimationFrame(playbackAnimationRef.current);
      playbackAnimationRef.current = null;
    }
  }, [chordNotebook, handleNotebookPlay, beatsToMs]);

  const handleAddParsedChord = useCallback((parsedChord: ParsedChord) => {
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
        noteSequence: parsedChord.noteSequence,
      },
    ]);
  }, []);

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

  const renderMessageContent = useCallback((content: string) => {
    // Regex to match [CHORD: ... ] ... [/CHORD] blocks
    const chordPattern = /\[CHORD:[^\]]+\][\s\S]*?\[\/CHORD\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let keyCounter = 0;

    while ((match = chordPattern.exec(content)) !== null) {
      // Add text before the chord
      if (match.index > lastIndex) {
        parts.push(content.substring(lastIndex, match.index));
      }

      const parsedChord = parseChordDefinition(match[0]);

      if (parsedChord) {
        const noteCount = parsedChord.noteSequence.length;
        // Add clickable chord button
        parts.push(
          <button
            key={`chord-${keyCounter++}`}
            type="button"
            onClick={() => handleAddParsedChord(parsedChord)}
            className="mx-1 inline-flex flex-col items-start gap-0.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 transition hover:border-blue-400 hover:bg-blue-100 hover:shadow-sm"
            title={`Click to add ${parsedChord.name} to playground`}
          >
            <div className="flex items-center gap-1">
              <span>{parsedChord.name}</span>
              <span className="text-[10px] text-blue-500">({parsedChord.measures} bar{parsedChord.measures !== 1 ? 's' : ''})</span>
              <span className="text-xs">+</span>
            </div>
            <span className="text-[9px] text-blue-400">{noteCount} notes</span>
          </button>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex));
    }

    return parts.length > 0 ? parts : content;
  }, [parseChordDefinition, handleAddParsedChord]);

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8 lg:px-8">
        <header className="flex flex-col gap-3 text-center lg:text-left">
          <h1 className="text-3xl font-semibold text-slate-900 lg:text-4xl">Interactive Harmony Studio</h1>
          <p className="text-base text-slate-600 lg:text-lg">
            Explore the chord network, capture ideas with an AI collaborator, and sculpt progressions in your musical sandbox.
          </p>
        </header>

        <section className="flex flex-col gap-6">
          {/* Chord Playground - Top */}
          <section className="rounded-2xl bg-white p-4 shadow-md sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Chord Playground</h2>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-slate-600">
                    BPM:
                  </label>
                  <input
                    type="number"
                    min="40"
                    max="240"
                    step="1"
                    value={bpm}
                    onChange={(e) => setBpm(parseInt(e.target.value) || 120)}
                    className="w-16 rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </div>
                <p className="text-xs text-slate-500">Click chords to play, drag to reorder.</p>
                {chordNotebook.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="rounded-md bg-slate-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700"
                  >
                    Clear All
                  </button>
                )}
                {isPlayingSequence ? (
                  <button
                    type="button"
                    onClick={handleStopSequence}
                    className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700"
                  >
                    ⏹ Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handlePlaySequence}
                    disabled={chordNotebook.length === 0}
                    className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    ▶ Play
                  </button>
                )}
              </div>
            </div>

            {chordNotebook.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Play a chord from the diagram or add chords from the chat. They will appear in the music sheet below.
              </p>
            ) : null}

            {/* Music Sheet Visualization - Main Interface */}
            {chordNotebook.length > 0 && (
              <div className="mt-6 border-t border-slate-200 pt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-700">Music Sheet</h3>
                    <span className="text-[10px] font-medium text-slate-500 px-2 py-0.5 rounded bg-slate-200">4/4 Time</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-slate-600">
                        Transpose:
                      </label>
                      <select
                        value={octaveTranspose}
                        onChange={(e) => setOctaveTranspose(parseInt(e.target.value))}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="-2">-2 octaves</option>
                        <option value="-1">-1 octave</option>
                        <option value="0">No transpose</option>
                        <option value="1">+1 octave</option>
                        <option value="2">+2 octaves</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={transposeDisplay}
                        onChange={(e) => setTransposeDisplay(e.target.checked)}
                        className="rounded"
                      />
                      Transpose display too
                    </label>
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
                      let accumulatedBeats = 0;

                      chordNotebook.forEach(entry => {
                        if (entry.noteSequence && entry.noteSequence.length > 0) {
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

                        const basePos = notePositions[note] ?? 0;
                        // Adjust for octave (each octave = 7 positions)
                        const octaveOffset = (octave - 4) * 7;
                        return basePos + octaveOffset;
                      };

                      // Staff lines (5 lines)
                      const staffLinePositions = [0, 1, 2, 3, 4];

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
                      const renderNoteSymbol = (duration: NoteDuration, yPos: number, xPos: number, isPlaying: boolean) => {
                        const isFilled = ['quarter', 'eighth', 'sixteenth', 'dotted-quarter', 'dotted-eighth'].includes(duration);
                        const hasFlag = ['eighth', 'sixteenth', 'dotted-eighth'].includes(duration);
                        const hasStem = duration !== 'whole';
                        const hasDot = duration.startsWith('dotted-');
                        const stemHeight = 35;
                        const stemUp = yPos < 74; // Stem direction based on position

                        const playColor = '#ef4444'; // Bright red for playing
                        const normalColor = '#000';

                        return (
                          <>
                            {/* Note head */}
                            <div
                              className={`absolute rounded-full transition-all ${isPlaying ? 'scale-125' : ''}`}
                              style={{
                                top: `${yPos - 4}px`,
                                left: `${xPos}px`,
                                width: '11px',
                                height: '8px',
                                backgroundColor: isFilled ? (isPlaying ? playColor : normalColor) : 'transparent',
                                border: isFilled ? 'none' : `2px solid ${isPlaying ? playColor : normalColor}`,
                                transform: 'rotate(-20deg)',
                                boxShadow: isPlaying ? '0 0 8px rgba(239, 68, 68, 0.6)' : 'none',
                              }}
                            />

                            {/* Stem */}
                            {hasStem && (
                              <div
                                className="absolute transition-all"
                                style={{
                                  top: stemUp ? `${yPos - stemHeight}px` : `${yPos}px`,
                                  left: stemUp ? `${xPos + 9}px` : `${xPos}px`,
                                  width: isPlaying ? '2px' : '1.5px',
                                  height: `${stemHeight}px`,
                                  backgroundColor: isPlaying ? playColor : normalColor,
                                }}
                              />
                            )}

                            {/* Flag for eighth/sixteenth notes */}
                            {hasFlag && (
                              <div
                                className="absolute text-xl font-bold transition-all"
                                style={{
                                  top: stemUp ? `${yPos - stemHeight - 5}px` : `${yPos + stemHeight - 15}px`,
                                  left: stemUp ? `${xPos + 7}px` : `${xPos - 3}px`,
                                  color: isPlaying ? playColor : normalColor,
                                  transform: stemUp ? 'scaleY(-1)' : 'none',
                                }}
                              >
                                {duration === 'sixteenth' ? '♬' : '♪'}
                              </div>
                            )}

                            {/* Dot for dotted notes */}
                            {hasDot && (
                              <div
                                className="absolute w-1.5 h-1.5 rounded-full transition-all"
                                style={{
                                  top: `${yPos - 1}px`,
                                  left: `${xPos + 15}px`,
                                  backgroundColor: isPlaying ? playColor : normalColor,
                                }}
                              />
                            )}
                          </>
                        );
                      };

                      return (
                        <div className="relative" style={{ minWidth: `${totalWidth}px` }}>
                          {/* Treble clef symbol */}
                          <div className="absolute left-0 top-3 text-3xl font-serif text-slate-700">
                            𝄞
                          </div>

                          {/* Staff lines - extended across all notes */}
                          <div className="relative ml-12" style={{ height: '120px' }}>
                            {staffLinePositions.map((linePos, idx) => (
                              <div
                                key={idx}
                                className="absolute border-t border-slate-400"
                                style={{
                                  top: `${54 + idx * 10}px`,
                                  left: 0,
                                  right: 0,
                                  width: `${totalWidth - 50}px`
                                }}
                              />
                            ))}

                            {/* Measure bar lines */}
                            {measureBars.map((beatPosition, idx) => (
                              <div
                                key={`bar-${idx}`}
                                className="absolute border-l-2 border-slate-600"
                                style={{
                                  top: '54px',
                                  left: `${beatPosition * beatSpacing}px`,
                                  height: '40px',
                                }}
                              />
                            ))}

                            {/* Playback position line (like Guitar Pro) */}
                            {currentPlaybackBeat !== null && (
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
                            )}

                            {/* Notes */}
                            <div className="absolute top-0 left-0 w-full">
                              {fullNotes.map((note, noteIdx) => {
                                // Check if this note is currently being played (playback line is on or past it)
                                const isPlaying = currentPlaybackBeat !== null &&
                                  currentPlaybackBeat >= note.beat &&
                                  currentPlaybackBeat < note.beat + durationToBeats(note.duration);

                                // Position based on beat number
                                const xPosition = note.beat * beatSpacing;

                                const position = getNotePosition(note.note, note.octave);
                                // Middle line (B4) = position 4 = 74px
                                // Each step up = -5px (half of 10px line spacing)
                                const yPos = 74 - position * 5;

                                return (
                                  <div key={noteIdx} className="absolute" style={{ left: `${xPosition}px` }} data-note-beat={note.beat}>
                                    {/* Render note symbol */}
                                    {renderNoteSymbol(note.duration, yPos, 0, isPlaying)}

                                    {/* Ledger lines for notes outside staff */}
                                    {yPos < 54 && Array.from({ length: Math.ceil((54 - yPos) / 10) }, (_, i) => (
                                      <div
                                        key={`ledger-above-${i}`}
                                        className="absolute border-t border-slate-400"
                                        style={{
                                          top: `${54 - (i + 1) * 10}px`,
                                          left: '-4px',
                                          width: '20px',
                                        }}
                                      />
                                    ))}
                                    {yPos > 94 && Array.from({ length: Math.ceil((yPos - 94) / 10) }, (_, i) => (
                                      <div
                                        key={`ledger-below-${i}`}
                                        className="absolute border-t border-slate-400"
                                        style={{
                                          top: `${94 + (i + 1) * 10}px`,
                                          left: '-4px',
                                          width: '20px',
                                        }}
                                      />
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Chord labels at the bottom - only show on first note of each measure */}
                          <div className="relative mt-8 ml-12" style={{ height: '20px' }}>
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

                                return (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => {
                                      if (chordEntry) {
                                        setExpandedChordId(chordEntry.entryId === expandedChordId ? null : chordEntry.entryId);
                                      }
                                    }}
                                    className="absolute text-[10px] font-semibold text-slate-700 hover:text-blue-600 hover:underline cursor-pointer transition-colors"
                                    style={{ left: `${item.beat * beatSpacing - 10}px` }}
                                    title="Click to edit chord"
                                  >
                                    {item.label}
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
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
            )}
          </section>

          {/* Chord Diagram (Left) and Chat (Right) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Chord Diagram - Left */}
            <section className="rounded-2xl bg-white p-4 shadow-md sm:p-6">
              <ChordDiagram ref={diagramRef} onChordTriggered={handleChordTriggered} />
            </section>

            {/* Creative Chat - Right */}
            <section className="flex flex-col rounded-2xl bg-white p-4 shadow-md sm:p-6" style={{ height: isConfigCollapsed ? '500px' : '400px' }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">Creative Chat</h2>
                  <button
                    type="button"
                    onClick={() => setIsConfigCollapsed(!isConfigCollapsed)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                    aria-label={isConfigCollapsed ? 'Show configuration' : 'Hide configuration'}
                  >
                    {isConfigCollapsed ? '⚙️ Show Config' : '⚙️ Hide Config'}
                  </button>
                  {isConfigCollapsed && activeAgent && selectedModel && (
                    <span className="text-xs text-slate-500">
                      {activeAgent.label} • {modelOptions.find(m => m.id === selectedModel)?.label ?? selectedModel}
                    </span>
                  )}
                </div>
                {!isConfigCollapsed && (
                  <div className="flex flex-col items-start gap-2 text-xs font-medium text-slate-600">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2">
                      Provider
                      <select
                        value={selectedProvider}
                        onChange={handleProviderChange}
                        disabled={isLoadingProviders || providers.length === 0}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {providers.map(option => {
                          const disabledOption = !option.available || option.models.length === 0;
                          const optionLabel = !option.available && option.error
                            ? `${option.label} (${option.error})`
                            : option.label;
                          return (
                            <option key={option.id} value={option.id} disabled={disabledOption}>
                              {optionLabel}
                            </option>
                          );
                        })}
                        {providers.length === 0 && (
                          <option value="">No providers</option>
                        )}
                      </select>
                    </label>
                    <label className="flex items-center gap-2">
                      Model
                      <select
                        value={selectedModel}
                        onChange={handleModelChange}
                        disabled={
                          isLoadingProviders || !modelOptions.length || !activeProvider?.available
                        }
                        className="min-w-[7rem] rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isLoadingProviders && <option value="">Loading...</option>}
                        {!isLoadingProviders && modelOptions.length === 0 && (
                          <option value="">No models</option>
                        )}
                        {modelOptions.map(option => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2">
                      Agent
                      <select
                        value={selectedAgentId}
                        onChange={handleAgentChange}
                        disabled={isLoadingAgents || agentProfiles.length === 0}
                        className="min-w-[8rem] rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isLoadingAgents && <option value="">Loading...</option>}
                        {!isLoadingAgents && agentProfiles.length === 0 && (
                          <option value="">No agents yet</option>
                        )}
                        {agentProfiles.map(agent => (
                          <option key={agent.id} value={agent.id}>
                            {agent.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={handleToggleAgentCreation}
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      {isCreatingAgent ? 'Cancel' : 'New profile'}
                    </button>
                </div>
              </div>
                )}
              </div>

            {!isConfigCollapsed && (
              <label className="mt-4 flex flex-col gap-2 text-xs text-slate-600">
              <span className="text-sm font-semibold text-slate-700">Session instructions</span>
              <textarea
                value={chatInstructions}
                onChange={event => setChatInstructions(event.target.value)}
                rows={6}
                placeholder="Describe the style, mood, and goals for this writing session..."
                className="min-h-[140px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              />
              <span className="text-[11px] text-slate-500">
                These notes are shared with the selected agent before each message.
              </span>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSendSessionSummary}
                  disabled={isSending || !activeAgent || !selectedModel || !agentPrompt}
                  className="rounded-md border border-blue-300 px-3 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  Send to agent
                </button>
              </div>
            </label>
            )}

            {!isConfigCollapsed && isLoadingProviders && (
              <p className="mt-2 text-xs text-slate-500">Loading models...</p>
            )}
              {!isConfigCollapsed && !isLoadingProviders && providerError && (
                <p className="mt-2 text-xs text-rose-600">{providerError}</p>
              )}
              {!isConfigCollapsed && !isLoadingProviders &&
                !providerError &&
                activeProvider &&
                !activeProvider.available &&
                activeProvider.error && (
                  <p className="mt-2 text-xs text-amber-600">{activeProvider.error}</p>
                )}
              {!isConfigCollapsed && isLoadingAgents && (
                <p className="mt-2 text-xs text-slate-500">Loading agent profiles...</p>
              )}
              {!isConfigCollapsed && !isLoadingAgents && agentError && (
                <p className="mt-2 text-xs text-rose-600">{agentError}</p>
              )}
              {!isConfigCollapsed && !isLoadingAgents && !agentError && activeAgent && (
                <p className="mt-2 text-xs text-slate-500">Agent: {activeAgent.label}</p>
              )}

              {!isConfigCollapsed && isCreatingAgent && (
                <form
                  onSubmit={handleCreateAgentSubmit}
                  className="mt-3 w-full rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 shadow-inner"
                >
                  <label className="flex flex-col gap-1">
                    <span className="font-semibold text-slate-600">Agent name</span>
                    <input
                      value={newAgentName}
                      onChange={event => setNewAgentName(event.target.value)}
                      placeholder="e.g. Ambient Architect"
                      className="rounded border border-slate-300 px-2 py-1 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="mt-3 flex flex-col gap-1">
                    <span className="font-semibold text-slate-600">Prompt</span>
                    <textarea
                      value={newAgentPrompt}
                      onChange={event => setNewAgentPrompt(event.target.value)}
                      rows={5}
                      placeholder="Describe how this agent should respond..."
                      className="rounded border border-slate-300 px-2 py-1 font-mono text-[11px] leading-relaxed focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={isSavingAgent}
                      className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      {isSavingAgent ? 'Saving...' : 'Save profile'}
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleAgentCreation}
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <div
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="mt-3 flex-1 overflow-y-auto rounded-md bg-slate-100/60 p-3"
              >
                {messages
                  .filter(message => message.role !== 'system')
                  .map(message => (
                    <article
                      key={message.id}
                      className={`mb-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm last:mb-0 ${
                        message.role === 'user'
                          ? 'border-blue-200 bg-blue-50/70'
                          : 'border-emerald-200 bg-emerald-50/60'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                        <span className="capitalize">{message.role}</span>
                        <span suppressHydrationWarning>{new Date(message.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="whitespace-pre-line leading-relaxed text-slate-800">
                        {renderMessageContent(message.content)}
                      </div>
                    </article>
                  ))}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="mt-3 flex gap-2">
                <input
                  value={chatInput}
                  onChange={event => setChatInput(event.target.value)}
                  disabled={
                    isSending ||
                    !selectedModel ||
                    !activeProvider?.available ||
                    !agentPrompt ||
                    !activeAgent
                  }
                  placeholder="Describe a groove, ask for a reharm, or outline a vibe..."
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                />
                <button
                  type="submit"
                  disabled={
                    isSendDisabled ||
                    !activeProvider?.available ||
                    !agentPrompt ||
                    !activeAgent
                  }
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {isSending ? 'Sending...' : 'Send'}
                </button>
              </form>
              {chatError && (
                <p className="mt-2 text-xs text-rose-600">{chatError}</p>
              )}
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
