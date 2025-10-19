import { NextResponse } from 'next/server';

interface ChatRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  provider: 'ollama';
  model: string;
  messages: ChatRequestMessage[];
}

interface OllamaChatResponse {
  message: {
    role: 'assistant';
    content: string;
  };
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

export async function POST(request: Request) {
  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (!body?.provider) {
    return NextResponse.json({ error: 'Missing provider' }, { status: 400 });
  }

  if (!body?.model?.trim()) {
    return NextResponse.json({ error: 'Missing model' }, { status: 400 });
  }

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'Missing messages' }, { status: 400 });
  }

  if (body.provider !== 'ollama') {
    return NextResponse.json({ error: `Unsupported provider: ${body.provider}` }, { status: 400 });
  }

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error: error || 'Ollama chat request failed' }, { status: 502 });
    }

    const data = (await response.json()) as OllamaChatResponse;
    return NextResponse.json({ message: data.message });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to contact Ollama',
      },
      { status: 502 }
    );
  }
}
