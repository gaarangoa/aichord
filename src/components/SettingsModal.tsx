'use client';

import React, { useState, useEffect } from 'react';
import type { ChordDiagramHandle } from '@/components/ChordDiagram';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  octaveTranspose: number;
  onOctaveTransposeChange: (transpose: number) => void;
  transposeDisplay: boolean;
  onTransposeDisplayChange: (display: boolean) => void;
  relativeVelocity: number;
  currentMedianVelocity: number;
  onRelativeVelocityChange: (velocity: number) => void;
  providers: Array<{ id: string; label: string; available: boolean; models: Array<{ id: string; label: string }>; error?: string }>;
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  agentProfiles: Array<{ id: string; label: string; prompt: string }>;
  selectedAgentId: string;
  onAgentChange: (agentId: string) => void;
  chatInstructions: string;
  onChatInstructionsChange: (instructions: string) => void;
  isLoadingProviders: boolean;
  isLoadingAgents: boolean;
  providerError: string | null;
  agentError: string | null;
  isCreatingAgent: boolean;
  onToggleAgentCreation: () => void;
  newAgentName: string;
  onNewAgentNameChange: (name: string) => void;
  newAgentPrompt: string;
  onNewAgentPromptChange: (prompt: string) => void;
  onCreateAgentSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  isSavingAgent: boolean;
  isSending: boolean;
  onSendSessionSummary: () => void;
  diagramRef: React.RefObject<ChordDiagramHandle | null>;
}

export default function SettingsModal({
  isOpen,
  onClose,
  bpm,
  onBpmChange,
  octaveTranspose,
  onOctaveTransposeChange,
  transposeDisplay,
  onTransposeDisplayChange,
  relativeVelocity,
  currentMedianVelocity,
  onRelativeVelocityChange,
  providers,
  selectedProvider,
  onProviderChange,
  selectedModel,
  onModelChange,
  agentProfiles,
  selectedAgentId,
  onAgentChange,
  chatInstructions,
  onChatInstructionsChange,
  isLoadingProviders,
  isLoadingAgents,
  providerError,
  agentError,
  isCreatingAgent,
  onToggleAgentCreation,
  newAgentName,
  onNewAgentNameChange,
  newAgentPrompt,
  onNewAgentPromptChange,
  onCreateAgentSubmit,
  isSavingAgent,
  isSending,
  onSendSessionSummary,
  diagramRef,
}: SettingsModalProps) {
  // Hooks must be called before any early returns
  const [midiState, setMidiState] = useState<{
    isSupported: boolean;
    hasAccess: boolean;
    outputs: Array<{ id: string; name: string; manufacturer?: string }>;
    selectedOutputId: string | null;
  } | null>(null);

  const [useInternalAudio, setUseInternalAudio] = useState(true);

  useEffect(() => {
    if (isOpen && diagramRef.current) {
      const updateMidiState = () => {
        setMidiState(diagramRef.current!.getMidiState());
        setUseInternalAudio(diagramRef.current!.getUseInternalAudio());
      };
      updateMidiState();
      const interval = setInterval(updateMidiState, 500);
      return () => clearInterval(interval);
    }
  }, [isOpen, diagramRef]);

  const handleRequestMidi = async () => {
    if (diagramRef.current) {
      await diagramRef.current.requestMidiAccess();
      setMidiState(diagramRef.current.getMidiState());
    }
  };

  const handleSelectMidiOutput = (outputId: string) => {
    if (diagramRef.current) {
      diagramRef.current.selectMidiOutput(outputId);
      setMidiState(diagramRef.current.getMidiState());
    }
  };

  const handleToggleInternalAudio = (enabled: boolean) => {
    if (diagramRef.current) {
      diagramRef.current.setUseInternalAudio(enabled);
      setUseInternalAudio(enabled);
    }
  };

  // Early return after all hooks
  if (!isOpen) return null;

  const activeProvider = providers.find(p => p.id === selectedProvider);
  const activeAgent = agentProfiles.find(a => a.id === selectedAgentId);
  const modelOptions = activeProvider?.models ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-2xl font-bold text-slate-900">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-8">
          {/* Playback Settings */}
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900 border-b border-slate-200 pb-2">Playback Settings</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">
                  BPM (Beats Per Minute)
                </label>
                <input
                  type="number"
                  min="40"
                  max="240"
                  step="1"
                  value={bpm}
                  onChange={(e) => onBpmChange(parseInt(e.target.value) || 120)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">
                  Octave Transpose
                </label>
                <select
                  value={octaveTranspose}
                  onChange={(e) => onOctaveTransposeChange(parseInt(e.target.value))}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="-2">-2 octaves</option>
                  <option value="-1">-1 octave</option>
                  <option value="0">No transpose</option>
                  <option value="1">+1 octave</option>
                  <option value="2">+2 octaves</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={transposeDisplay}
                onChange={(e) => onTransposeDisplayChange(e.target.checked)}
                className="rounded"
              />
              Transpose display too
            </label>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-700">
                Relative Velocity (Current median: {currentMedianVelocity})
              </label>
              <input
                type="number"
                min="1"
                max="127"
                value={relativeVelocity}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (!Number.isNaN(value)) {
                    onRelativeVelocityChange(value);
                  }
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                title="Set target velocity; existing notes shift together"
              />
              <span className="text-xs text-slate-500">
                Adjust all note velocities relative to the median
              </span>
            </div>
          </section>

          {/* MIDI Settings */}
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900 border-b border-slate-200 pb-2">MIDI Settings</h3>

            {!midiState ? (
              <p className="text-sm text-slate-500">Loading MIDI status...</p>
            ) : !midiState.isSupported ? (
              <p className="text-sm text-slate-600">MIDI is not supported in this browser.</p>
            ) : !midiState.hasAccess ? (
              <button
                type="button"
                onClick={handleRequestMidi}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Connect MIDI
              </button>
            ) : (
              <div className="flex flex-col gap-4">
                {midiState?.outputs.length === 0 ? (
                  <p className="text-sm text-slate-600">No MIDI outputs detected.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-slate-700">
                      MIDI Output Device
                    </label>
                    <select
                      value={midiState?.selectedOutputId ?? ''}
                      onChange={(e) => handleSelectMidiOutput(e.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      {midiState?.outputs.map(output => (
                        <option key={output.id} value={output.id}>
                          {output.name} {output.manufacturer ? `(${output.manufacturer})` : ''}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-slate-500">
                      Selected device will receive all MIDI playback
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Internal Audio Toggle */}
            <div className="pt-4 border-t border-slate-200">
              <label className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-700">Internal Audio</span>
                  <span className="text-xs text-slate-500">Enable browser audio playback</span>
                </div>
                <input
                  type="checkbox"
                  checked={useInternalAudio}
                  onChange={(e) => handleToggleInternalAudio(e.target.checked)}
                  className="h-5 w-5 rounded accent-blue-600"
                />
              </label>
            </div>
          </section>

          {/* AI Agent Settings */}
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900 border-b border-slate-200 pb-2">AI Agent Settings</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">
                  Provider
                </label>
                <select
                  value={selectedProvider}
                  onChange={(e) => onProviderChange(e.target.value)}
                  disabled={isLoadingProviders || providers.length === 0}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
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
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">
                  Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => onModelChange(e.target.value)}
                  disabled={isLoadingProviders || !modelOptions.length || !activeProvider?.available}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
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
              </div>
            </div>

            {isLoadingProviders && (
              <p className="text-xs text-slate-500">Loading models...</p>
            )}
            {!isLoadingProviders && providerError && (
              <p className="text-xs text-rose-600">{providerError}</p>
            )}
            {!isLoadingProviders && !providerError && activeProvider && !activeProvider.available && activeProvider.error && (
              <p className="text-xs text-amber-600">{activeProvider.error}</p>
            )}

            <div className="flex items-center gap-4">
              <div className="flex-1 flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">
                  Agent Profile
                </label>
                <select
                  value={selectedAgentId}
                  onChange={(e) => onAgentChange(e.target.value)}
                  disabled={isLoadingAgents || agentProfiles.length === 0}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
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
              </div>
              <button
                type="button"
                onClick={onToggleAgentCreation}
                className="mt-7 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                {isCreatingAgent ? 'Cancel' : 'New profile'}
              </button>
            </div>

            {isLoadingAgents && (
              <p className="text-xs text-slate-500">Loading agent profiles...</p>
            )}
            {!isLoadingAgents && agentError && (
              <p className="text-xs text-rose-600">{agentError}</p>
            )}
            {!isLoadingAgents && !agentError && activeAgent && (
              <p className="text-xs text-slate-500">Agent: {activeAgent.label}</p>
            )}

            {isCreatingAgent && (
              <form
                onSubmit={onCreateAgentSubmit}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3"
              >
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-700">
                    Agent name
                  </label>
                  <input
                    value={newAgentName}
                    onChange={(e) => onNewAgentNameChange(e.target.value)}
                    placeholder="e.g. Ambient Architect"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-700">
                    Prompt
                  </label>
                  <textarea
                    value={newAgentPrompt}
                    onChange={(e) => onNewAgentPromptChange(e.target.value)}
                    rows={5}
                    placeholder="Describe how this agent should respond..."
                    className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs leading-relaxed focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isSavingAgent}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    {isSavingAgent ? 'Saving...' : 'Save profile'}
                  </button>
                  <button
                    type="button"
                    onClick={onToggleAgentCreation}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700">
                Session instructions
              </label>
              <textarea
                value={chatInstructions}
                onChange={(e) => onChatInstructionsChange(e.target.value)}
                rows={6}
                placeholder="Describe the style, mood, and goals for this writing session..."
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <span className="text-xs text-slate-500">
                These notes are shared with the selected agent before each message.
              </span>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onSendSessionSummary}
                  disabled={isSending || !activeAgent || !selectedModel}
                  className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  Send to agent
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-6 py-4 flex justify-end rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
