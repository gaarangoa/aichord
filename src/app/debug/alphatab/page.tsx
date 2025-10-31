'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { AlphaTabApi } from '@coderline/alphatab';
import AlphaTabNotation from '@/components/AlphaTabNotation';

const DEFAULT_SOURCE = [
  '\\title "AlphaTab Playground Demo"',
  '\\subtitle "Try editing the AlphaTex on the left"',
  '\\tempo 96',
  '.',
  ':4 (c4 e4 g4)',
  ':4 r',
  ':4 (d4 f4 a4)',
  ':8 r',
  ':8 (g4 b4 d5)',
  ':4 c4',
  '|',
].join('\n');

const PRESETS: Array<{ label: string; value: string }> = [
  {
    label: 'C Major Arpeggio',
    value: [
      '\\title "C Major Arpeggio"',
      '\\tempo 110',
      '.',
      ':8 c4',
      ':8 e4',
      ':8 g4',
      ':8 c5',
      ':8 e5',
      ':8 g5',
      ':8 c6',
      ':8 r',
      ':4 c5',
      ':4 e5',
      ':4 g5',
      ':4 c6',
      '|',
    ].join('\n'),
  },
  {
    label: 'D Minor Chords',
    value: [
      '\\title "D Minor Chord Progression"',
      '\\tempo 80',
      '.',
      ':4 (d4 f4 a4)',
      ':4 (g3 d4 g4)',
      ':4 (a3 e4 a4)',
      ':4 (d4 a4 d5)',
      '|',
    ].join('\n'),
  },
  {
    label: 'Rhythmic Study',
    value: [
      '\\title "Rhythmic Study"',
      '\\tempo 100',
      '.',
      ':4 c4',
      ':8 { d } c4',
      ':4 { d } c4',
      ':8 c4',
      ':8 r',
      ':16 c4',
      ':16 c4',
      ':4 r',
      '|',
    ].join('\n'),
  },
];

export default function AlphaTabPlaygroundPage() {
  const [editorText, setEditorText] = useState(DEFAULT_SOURCE);
  const [renderText, setRenderText] = useState(DEFAULT_SOURCE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLive, setIsLive] = useState<boolean>(false);
  const errorUnsubscribeRef = useRef<(() => void) | null>(null);

  const alphatexLines = useMemo(() => renderText.split('\n').length, [renderText]);

  const registerErrorListener = useCallback(
    (api: AlphaTabApi) => {
      errorUnsubscribeRef.current?.();
      const unsubscribe = api.error.on(err => {
        const message =
          typeof err === 'string'
            ? err
            : err?.message ?? 'Unknown AlphaTab error. Open the console for more details.';
        setErrorMessage(message);
        console.error('[alphaTab:error]', err);
      });
      errorUnsubscribeRef.current = unsubscribe;
    },
    [setErrorMessage]
  );

  const handleRender = useCallback(() => {
    setRenderText(editorText.trim().length > 0 ? editorText : DEFAULT_SOURCE);
    setErrorMessage(null);
  }, [editorText]);

  const handlePreset = useCallback((preset: string) => {
    setEditorText(preset);
    setRenderText(preset);
    setErrorMessage(null);
  }, []);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 lg:flex-row">
        <section className="flex-1 rounded-xl bg-white p-6 shadow">
          <header>
            <h1 className="text-2xl font-semibold text-slate-900">AlphaTab Playground</h1>
            <p className="mt-2 text-sm text-slate-600">
              Edit the AlphaTex source, then click <strong>Render</strong>. Toggle the live preview if you want updates
              as you type.
            </p>
          </header>

          <div className="mt-6 flex flex-wrap gap-3">
            {PRESETS.map(preset => (
              <button
                key={preset.label}
                type="button"
                onClick={() => handlePreset(preset.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setEditorText(DEFAULT_SOURCE);
                setRenderText(DEFAULT_SOURCE);
                setErrorMessage(null);
              }}
              className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Reset to default
            </button>
          </div>

          <div className="mt-6">
            <label htmlFor="alphatex-input" className="mb-2 block text-sm font-medium text-slate-700">
              AlphaTex Source
            </label>
            <textarea
              id="alphatex-input"
              value={editorText}
              onChange={event => {
                const next = event.target.value;
                setEditorText(next);
                if (isLive) {
                  setRenderText(next);
                  setErrorMessage(null);
                }
              }}
              spellCheck={false}
              rows={Math.min(Math.max(alphatexLines + 2, 12), 28)}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-800 outline-none focus:border-blue-500 focus:ring"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleRender}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-700"
            >
              Render
            </button>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={isLive}
                onChange={event => {
                  const live = event.target.checked;
                  setIsLive(live);
                  if (live) {
                    setRenderText(editorText);
                    setErrorMessage(null);
                  }
                }}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Live preview while typing
            </label>
            {errorMessage && (
              <span className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700">
                {errorMessage}
              </span>
            )}
          </div>
        </section>

        <section className="flex-1 rounded-xl bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-slate-900">Rendered Score</h2>
          <p className="mt-1 text-xs text-slate-500">
            The notation below is rendered by AlphaTab using the AlphaTex source from the editor.
          </p>
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-4">
            <AlphaTabNotation
              alphaTex={renderText}
              onReady={api => {
                setErrorMessage(null);
                registerErrorListener(api);
              }}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
