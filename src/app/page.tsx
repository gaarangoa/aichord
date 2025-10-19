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

interface ChordNotebookEntry {
  entryId: string;
  chord: ChordTriggerEvent;
  addedAt: number;
}

const DEFAULT_PROVIDER: ChatProvider = 'ollama';

const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const CHORDS_MARKER = 'CHORDS:';

const parseAssistantResponse = (input: string): { reasoning: string; chords: string | null } => {
  const source = input ?? '';
  const upper = source.toUpperCase();
  const markerIndex = upper.indexOf(CHORDS_MARKER);

  if (markerIndex === -1) {
    return {
      reasoning: source.trim(),
      chords: null as string | null,
    };
  }

  const reasoning = source.slice(0, markerIndex).trim();
  const chords = source.slice(markerIndex + CHORDS_MARKER.length).trim();

  return {
    reasoning,
    chords: chords.length > 0 ? chords : null,
  };
};

const ChordDiagram = dynamic(
  () => import('@/components/ChordDiagram'),
  { ssr: false }
) as ForwardRefExoticComponent<ChordDiagramProps & RefAttributes<ChordDiagramHandle>>;

export default function Home() {
  const diagramRef = useRef<ChordDiagramHandle>(null);
  const suppressNotebookAppendRef = useRef(false);
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
      content: 'Hi! I’m your harmonic co-pilot. Play chords on the graph and I’ll keep track so we can workshop progressions together.',
      timestamp: Date.now(),
    },
  ]);
  const [chordNotebook, setChordNotebook] = useState<ChordNotebookEntry[]>([]);

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
      },
    ]);
  }, []);

  const handleChordTriggered = useCallback((event: ChordTriggerEvent) => {
    const friendlyQuality = event.type.replace(/([A-Z])/g, ' $1').toLowerCase();
    appendMessage({
      id: createId(),
      role: 'system',
      content: `🎵 Played ${event.label} — ${friendlyQuality.trim()}`,
      chord: event,
      timestamp: Date.now(),
    });
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
      setIsSending(true);

      const conversationMessages = [...messages, userMessage];

      const trimmedInstructions = chatInstructions.trim();
      const progressionLabels = chordNotebook.map(entry => entry.chord.label);
      const progressionMessage = progressionLabels.length
        ? `Chord progression: ${progressionLabels.join(' , ')}`
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

      const conversation = [
        ...systemMessages,
        ...conversationMessages.map(message => ({
          role: message.role,
          content: message.content,
        })),
      ];

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            provider: selectedProvider,
            model: selectedModel,
            messages: conversation,
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

        const { reasoning, chords } = parseAssistantResponse(assistantContent);

        if (reasoning) {
          appendMessage({
            id: createId(),
            role: 'assistant',
            content: reasoning,
            timestamp: Date.now(),
          });
        }

        if (chords) {
          appendMessage({
            id: createId(),
            role: 'assistant',
            content: chords,
            timestamp: Date.now(),
            variant: 'chords',
          });
        }

        if (!reasoning && !chords) {
          appendMessage({
            id: createId(),
            role: 'assistant',
            content: assistantContent,
            timestamp: Date.now(),
          });
        }
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
    [activeAgent, agentPrompt, appendMessage, chatInput, chatInstructions, chordNotebook, isSending, messages, selectedModel, selectedProvider]
  );

  const handlePlayFromMessage = useCallback((chord: ChordTriggerEvent) => {
    diagramRef.current?.playChordById(chord.id);
  }, []);

  const handleNotebookPlay = useCallback(async (entryId: string) => {
    const target = chordNotebook.find(entry => entry.entryId === entryId);
    if (!target) {
      return;
    }
    suppressNotebookAppendRef.current = true;
    try {
      await diagramRef.current?.playChordById(target.chord.id);
    } finally {
      suppressNotebookAppendRef.current = false;
    }
  }, [chordNotebook]);

  const handleNotebookRemove = useCallback((entryId: string) => {
    setChordNotebook(prev => prev.filter(entry => entry.entryId !== entryId));
  }, []);

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
          <section className="flex h-[440px] flex-col rounded-2xl bg-white p-4 shadow-md sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">Creative Chat</h2>
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
            </div>

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
            </label>

            {isLoadingProviders && (
              <p className="mt-2 text-xs text-slate-500">Loading models...</p>
            )}
              {!isLoadingProviders && providerError && (
                <p className="mt-2 text-xs text-rose-600">{providerError}</p>
              )}
              {!isLoadingProviders &&
                !providerError &&
                activeProvider &&
                !activeProvider.available &&
                activeProvider.error && (
                  <p className="mt-2 text-xs text-amber-600">{activeProvider.error}</p>
                )}
              {isLoadingAgents && (
                <p className="mt-2 text-xs text-slate-500">Loading agent profiles...</p>
              )}
              {!isLoadingAgents && agentError && (
                <p className="mt-2 text-xs text-rose-600">{agentError}</p>
              )}
              {!isLoadingAgents && !agentError && activeAgent && (
                <p className="mt-2 text-xs text-slate-500">Agent: {activeAgent.label}</p>
              )}

              {isCreatingAgent && (
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

              <div className="mt-3 flex-1 overflow-y-auto rounded-md bg-slate-100/60 p-3">
                {messages.filter(message => message.variant === 'chords').length === 0 ? (
                  <p className="text-sm text-slate-500">
                    Suggested chords from the agent will appear here.
                  </p>
                ) : (
                  messages
                    .filter(message => message.variant === 'chords')
                    .map(message => (
                  <article
                    key={message.id}
                    className={`mb-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm last:mb-0 ${
                      message.role === 'user'
                        ? 'border-blue-200 bg-blue-50/70'
                        : message.variant === 'chords'
                        ? 'border-emerald-200 bg-emerald-50/60'
                        : ''
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                      <span className="capitalize">
                        {message.variant === 'chords' ? 'chords' : message.role}
                      </span>
                      <span suppressHydrationWarning>{
                        new Date(message.timestamp).toLocaleTimeString()
                      }</span>
                    </div>
                    {message.variant === 'chords' ? (
                      <div className="space-y-1 text-slate-800">
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                          Suggested chords
                        </p>
                        <p className="whitespace-pre-line font-mono text-[13px] leading-relaxed">
                          {message.content}
                        </p>
                      </div>
                    ) : (
                      <p className="whitespace-pre-line leading-relaxed text-slate-800">
                        {message.content}
                      </p>
                    )}
                    {message.chord && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">{message.chord.label}</span>
                        <button
                          type="button"
                          onClick={() => handlePlayFromMessage(message.chord!)}
                          className="rounded border border-blue-300 px-2 py-1 text-blue-600 transition hover:bg-blue-50"
                        >
                          Play
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddChordToNotebook(message.chord!)}
                          className="rounded border border-slate-300 px-2 py-1 transition hover:bg-slate-100"
                        >
                          Add to pad
                        </button>
                      </div>
                    )}
                  </article>
                    ))
                )}
              </div>

              <form onSubmit={handleSendMessage} className="hidden">
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

          <section className="rounded-2xl bg-white p-4 shadow-md sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Chord Playground</h2>
              <p className="text-xs text-slate-500">Captured chords displayed as plain text.</p>
            </div>

            {chordNotebook.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Play a chord to drop it here. Each entry will appear as a simple label.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {chordNotebook.map(entry => (
                  <div key={entry.entryId} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleNotebookPlay(entry.entryId)}
                      className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                      {entry.chord.label}
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
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-md sm:p-6">
            <ChordDiagram ref={diagramRef} onChordTriggered={handleChordTriggered} />
          </section>
        </section>
      </main>
    </div>
  );
}
