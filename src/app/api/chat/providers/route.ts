import { NextResponse } from 'next/server';

interface OllamaTag {
  name: string;
  model: string;
  modified_at: string;
  size?: number;
}

interface ProviderModel {
  id: string;
  label: string;
}

interface ProviderInfo {
  id: 'ollama' | 'openai';
  label: string;
  available: boolean;
  models: ProviderModel[];
  error?: string;
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

export async function GET() {
  const providers: ProviderInfo[] = [];

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = (await response.json()) as { models: OllamaTag[] };
    const models: ProviderModel[] = data.models.map(model => ({
      id: model.model,
      label: model.name,
    }));

    providers.push({
      id: 'ollama',
      label: 'Ollama (local)',
      available: models.length > 0,
      models,
    });
  } catch (error) {
    providers.push({
      id: 'ollama',
      label: 'Ollama (local)',
      available: false,
      models: [],
      error: error instanceof Error ? error.message : 'Failed to reach Ollama',
    });
  }

  providers.push({
    id: 'openai',
    label: 'OpenAI',
    available: false,
    models: [],
    error: 'Provider coming soon',
  });

  return NextResponse.json({ providers });
}
