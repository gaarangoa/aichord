import { NextResponse } from 'next/server';

interface ChatRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatStreamRequestBody {
  provider: 'ollama';
  model: string;
  sessionId: string;
  systemMessages?: ChatRequestMessage[];
  history?: ChatRequestMessage[];
  message: string;
}

interface OllamaStreamChunk {
  message?: {
    role: 'assistant';
    content?: string;
  };
  done?: boolean;
  eval_count?: number;
  error?: string;
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const sessionStore = new Map<string, ChatRequestMessage[]>();

const normalizeMessages = (messages?: ChatRequestMessage[]): ChatRequestMessage[] => {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .filter(message => typeof message?.content === 'string' && message.content.trim().length > 0)
    .map(message => ({
      role: message.role,
      content: message.content.trim(),
    }));
};

export async function POST(request: Request) {
  let body: ChatStreamRequestBody;

  try {
    body = (await request.json()) as ChatStreamRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (body.provider !== 'ollama') {
    return NextResponse.json({ error: `Unsupported provider: ${body.provider}` }, { status: 400 });
  }

  const model = body.model?.trim();
  if (!model) {
    return NextResponse.json({ error: 'Missing model' }, { status: 400 });
  }

  const sessionId = body.sessionId?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const userMessage = body.message?.trim();
  if (!userMessage) {
    return NextResponse.json({ error: 'Missing message content' }, { status: 400 });
  }

  try {
    const systemMessages = normalizeMessages(body.systemMessages);
    const historyMessages = normalizeMessages(body.history);

    let messages = sessionStore.get(sessionId) ?? [];

    if (historyMessages.length > 0) {
      messages = [
        ...(systemMessages.length > 0 ? systemMessages : messages.filter(message => message.role === 'system')),
        ...historyMessages,
      ];
    } else if (systemMessages.length > 0) {
      const nonSystemMessages = messages.filter(message => message.role !== 'system');
      messages = [...systemMessages, ...nonSystemMessages];
    }

    messages = [...messages.filter(message => message.role === 'system'), ...messages.filter(message => message.role !== 'system')];
    messages = [...messages, { role: 'user', content: userMessage }];
    sessionStore.set(sessionId, messages);

    const upstreamResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      sessionStore.set(sessionId, messages.slice(0, -1));
      const errorText = upstreamResponse.body ? await upstreamResponse.text() : '';
      return NextResponse.json(
        { error: errorText || 'Ollama chat request failed' },
        { status: upstreamResponse.status || 502 }
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = upstreamResponse.body.getReader();
    const abortSignal = request.signal;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const flushEvent = async (payload: Record<string, unknown>) => {
          if (cancelled) {
            return;
          }
          const data = `data: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(data));
        };

        let assistantContent = '';
        let outputTokens: number | undefined;
        let buffer = '';
        let cancelled = false;

        const abortHandler = () => {
          cancelled = true;
          reader.cancel().catch(() => null);
          if (!cancelled) {
            cancelled = true;
            controller.close();
          }
        };

        if (abortSignal.aborted) {
          abortHandler();
          return;
        }

        abortSignal.addEventListener('abort', abortHandler);

        (async () => {
          try {
            while (!cancelled) {
              const { value, done } = await reader.read();
              if (done) {
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) {
                  continue;
                }

                let chunk: OllamaStreamChunk;
                try {
                  chunk = JSON.parse(trimmed) as OllamaStreamChunk;
                } catch {
                  continue;
                }

                if (chunk.error) {
                  throw new Error(chunk.error);
                }

                const delta = chunk.message?.content ?? '';
                if (delta) {
                  assistantContent += delta;
                  await flushEvent({ delta });
                }

                if (chunk.done) {
                  if (typeof chunk.eval_count === 'number') {
                    outputTokens = chunk.eval_count;
                  }
                }
              }
            }

            if (buffer.trim()) {
              let chunk: OllamaStreamChunk | undefined;
              try {
                chunk = JSON.parse(buffer.trim()) as OllamaStreamChunk;
              } catch {
                chunk = undefined;
              }
              if (chunk?.error) {
                throw new Error(chunk.error);
              }
              if (chunk?.message?.content) {
                assistantContent += chunk.message.content;
                await flushEvent({ delta: chunk.message.content });
              }
              if (chunk?.done && typeof chunk.eval_count === 'number') {
                outputTokens = chunk.eval_count;
              }
            }

            messages.push({ role: 'assistant', content: assistantContent });
            sessionStore.set(sessionId, messages);

            await flushEvent({ done: true, content: assistantContent, tokens: outputTokens ?? null });
            if (!cancelled) {
              cancelled = true;
              controller.close();
            }
          } catch (error) {
            sessionStore.set(sessionId, messages.slice(0, -1));
            const message = error instanceof Error ? error.message : 'Failed to read Ollama response stream';
            await flushEvent({ error: message });
            if (!cancelled) {
              cancelled = true;
              controller.close();
            }
          } finally {
            abortSignal.removeEventListener('abort', abortHandler);
          }
        })().catch(async error => {
          sessionStore.set(sessionId, messages.slice(0, -1));
          const message = error instanceof Error ? error.message : 'Failed to process Ollama stream';
          await flushEvent({ error: message });
          if (!cancelled) {
            cancelled = true;
            controller.close();
          }
        });
      },
      cancel() {
        reader.cancel().catch(() => null);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to contact Ollama',
      },
      { status: 502 }
    );
  }
}
