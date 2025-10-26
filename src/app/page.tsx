'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ForwardRefExoticComponent, RefAttributes } from 'react';
import dynamic from 'next/dynamic';
import type { ChordDiagramHandle, ChordDiagramProps, ChordTriggerEvent } from '@/components/ChordDiagram';

type ChatProvider = 'ollama' | 'openai';

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

interface NoteEvent {
  note: string;        // Note name (C, D#, E, etc.)
  octave: number;      // Octave number (2-6)
  startOffset: number; // Seconds from chord start
  duration: number;    // Seconds to sustain
}

interface ChordNotebookEntry {
  entryId: string;
  chord: ChordTriggerEvent;
  addedAt: number;
  tempoSeconds: number;    // Total duration before next chord
  noteSequence?: NoteEvent[]; // Detailed note sequence
}

interface ParsedChord {
  name: string;
  tempo: number;
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
  const [editTempoInput, setEditTempoInput] = useState('1.8');
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [isPlayingSequence, setIsPlayingSequence] = useState(false);
  const [currentlyPlayingChordId, setCurrentlyPlayingChordId] = useState<string | null>(null);
  const [expandedChordId, setExpandedChordId] = useState<string | null>(null);
  const sequenceAbortRef = useRef<boolean>(false);

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
    setChordNotebook(prev => [
      ...prev,
      {
        entryId: createId(),
        chord,
        addedAt: Date.now(),
        tempoSeconds: 1.8, // Default tempo
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
        `${entry.chord.label} (${entry.tempoSeconds}s)`
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
        console.log('Sending note sequence to MIDI via ChordDiagram');
        diagramRef.current?.sendMidiNoteSequence(target.noteSequence, {
          velocity: 96,
          velocityVariancePercent: 10,
        });
      } else {
        // Otherwise use the chord diagram's built-in playback
        console.log('Using chord diagram playback for:', target.chord.id);
        await diagramRef.current?.playChordById(target.chord.id);
      }
    } finally {
      suppressNotebookAppendRef.current = false;
    }
  }, [chordNotebook]);

  const handleNotebookRemove = useCallback((entryId: string) => {
    setChordNotebook(prev => prev.filter(entry => entry.entryId !== entryId));
  }, []);

  const handleStartEditChord = useCallback((entry: ChordNotebookEntry) => {
    setEditingChordId(entry.entryId);
    setEditChordInput(entry.chord.label);
    setEditTempoInput(entry.tempoSeconds.toString());
  }, []);

  const handleSaveEditChord = useCallback((entryId: string) => {
    const newLabel = editChordInput.trim();
    if (!newLabel) {
      setEditingChordId(null);
      return;
    }

    const newTempo = parseFloat(editTempoInput);
    const validTempo = !isNaN(newTempo) && newTempo > 0 ? newTempo : 1.8;

    setChordNotebook(prev => prev.map(entry => {
      if (entry.entryId === entryId) {
        // Create a new chord object with updated label, id, and tempo
        return {
          ...entry,
          chord: {
            ...entry.chord,
            id: newLabel,
            label: newLabel,
          },
          tempoSeconds: validTempo,
        };
      }
      return entry;
    }));

    setEditingChordId(null);
    setEditChordInput('');
    setEditTempoInput('1.8');
  }, [editChordInput, editTempoInput]);

  const handleCancelEditChord = useCallback(() => {
    setEditingChordId(null);
    setEditChordInput('');
    setEditTempoInput('1.8');
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
  }, []);

  const handlePlaySequence = useCallback(async () => {
    if (chordNotebook.length === 0) return;

    sequenceAbortRef.current = false;
    setIsPlayingSequence(true);

    for (const entry of chordNotebook) {
      if (sequenceAbortRef.current) break;

      setCurrentlyPlayingChordId(entry.entryId);
      await handleNotebookPlay(entry.entryId);
      await new Promise(resolve => setTimeout(resolve, entry.tempoSeconds * 1000));
    }

    setIsPlayingSequence(false);
    setCurrentlyPlayingChordId(null);
  }, [chordNotebook, handleNotebookPlay]);

  const handleChordClick = useCallback(async (chordLabel: string) => {
    suppressNotebookAppendRef.current = true;
    try {
      const chordEntry = chordNotebook.find(entry => entry.chord.label === chordLabel);
      if (chordEntry) {
        await diagramRef.current?.playChordById(chordEntry.chord.id);
      }
    } finally {
      suppressNotebookAppendRef.current = false;
    }
  }, [chordNotebook]);

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
        tempoSeconds: parsedChord.tempo,
        noteSequence: parsedChord.noteSequence,
      },
    ]);
  }, []);

  const parseChordDefinition = useCallback((chordBlock: string): ParsedChord | null => {
    // Parse format:
    // [CHORD: name | tempo]
    // Note, Octave, StartOffset, Duration
    // ...
    // [/CHORD]

    const headerMatch = chordBlock.match(/\[CHORD:\s*([^|]+)\s*\|\s*([^\]]+)\]/);
    if (!headerMatch) {
      console.warn('Failed to parse chord header from:', chordBlock.substring(0, 100));
      return null;
    }

    const name = headerMatch[1].trim();
    const tempo = parseFloat(headerMatch[2].trim());

    if (!name || isNaN(tempo)) {
      console.warn('Invalid chord name or tempo:', { name, tempo });
      return null;
    }

    // Extract note lines between header and [/CHORD]
    const noteLines = chordBlock
      .split('\n')
      .slice(1) // Skip header line
      .filter(line => line.trim() && !line.includes('[/CHORD]'));

    const noteSequence: NoteEvent[] = [];

    for (const line of noteLines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length !== 4) continue;

      const note = parts[0];
      const octave = parseInt(parts[1]);
      const startOffset = parseFloat(parts[2]);
      const duration = parseFloat(parts[3]);

      if (!note || isNaN(octave) || isNaN(startOffset) || isNaN(duration)) continue;

      noteSequence.push({ note, octave, startOffset, duration });
    }

    if (noteSequence.length === 0) {
      console.warn('No valid notes parsed from chord block');
      return null;
    }

    console.log(`Parsed chord: ${name} (${tempo}s) with ${noteSequence.length} notes:`, noteSequence);
    return { name, tempo, noteSequence };
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
              <span className="text-[10px] text-blue-500">({parsedChord.tempo}s)</span>
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
                <p className="text-xs text-slate-500">Click chords to play, drag to reorder, edit tempo individually.</p>
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
                Play a chord to drop it here. Each entry will appear as a simple label.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {chordNotebook.map((entry, index) => (
                  <div
                    key={entry.entryId}
                    draggable={editingChordId !== entry.entryId}
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`flex flex-col gap-1 rounded-lg border p-2 transition-all ${
                      currentlyPlayingChordId === entry.entryId
                        ? 'border-emerald-500 bg-emerald-100 shadow-lg ring-2 ring-emerald-400'
                        : draggingIndex === index
                        ? 'border-blue-400 bg-blue-100 opacity-50'
                        : 'border-slate-200 bg-white'
                    } ${editingChordId !== entry.entryId ? 'cursor-move' : ''}`}
                  >
                    {editingChordId === entry.entryId ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editChordInput}
                            onChange={(e) => setEditChordInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleSaveEditChord(entry.entryId);
                              } else if (e.key === 'Escape') {
                                handleCancelEditChord();
                              }
                            }}
                            placeholder="e.g. Cmaj7"
                            className="w-20 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-sm font-medium text-blue-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300"
                            autoFocus
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={editTempoInput}
                            onChange={(e) => setEditTempoInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleSaveEditChord(entry.entryId);
                              } else if (e.key === 'Escape') {
                                handleCancelEditChord();
                              }
                            }}
                            placeholder="1.8"
                            min="0.1"
                            max="10"
                            step="0.1"
                            className="w-16 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                          <span className="text-[10px] text-slate-500">sec</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSaveEditChord(entry.entryId)}
                            className="rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 transition hover:bg-green-100"
                            aria-label="Save edit"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEditChord}
                            className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                            aria-label="Cancel edit"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleNotebookPlay(entry.entryId)}
                            className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-300"
                          >
                            {entry.chord.label}
                          </button>
                          {entry.noteSequence && entry.noteSequence.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedChordId(expandedChordId === entry.entryId ? null : entry.entryId)}
                              className="rounded-full border border-transparent px-2 text-xs font-semibold text-purple-500 transition hover:border-purple-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                              aria-label={`${expandedChordId === entry.entryId ? 'Hide' : 'Show'} notes`}
                            >
                              {expandedChordId === entry.entryId ? '▼' : '♪'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleStartEditChord(entry)}
                            className="rounded-full border border-transparent px-2 text-xs font-semibold text-slate-500 transition hover:border-slate-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                            aria-label={`Edit ${entry.chord.label}`}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            onClick={() => handleNotebookRemove(entry.entryId)}
                            className="rounded-full border border-transparent px-2 text-xs font-semibold text-blue-500 transition hover:border-blue-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                            aria-label={`Remove ${entry.chord.label} from playground`}
                          >
                            ×
                          </button>
                        </div>
                        <div className="text-center text-[10px] text-slate-500">
                          {entry.tempoSeconds.toFixed(1)}s
                          {entry.noteSequence && ` • ${entry.noteSequence.length} notes`}
                        </div>
                        {expandedChordId === entry.entryId && entry.noteSequence && (
                          <div className="mt-2 w-full border-t border-slate-200 pt-2">
                            <div className="text-[9px] font-semibold text-slate-600 mb-1">Notes:</div>
                            <div className="flex flex-col gap-0.5">
                              {entry.noteSequence.map((note, noteIdx) => (
                                <div key={noteIdx} className="flex items-center gap-1 text-[9px] text-slate-600">
                                  <span className="font-mono font-semibold text-purple-600">{note.note}{note.octave}</span>
                                  <span className="text-slate-400">@{note.startOffset.toFixed(2)}s</span>
                                  <span className="text-slate-400">({note.duration.toFixed(2)}s)</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
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
