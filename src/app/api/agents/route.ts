import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

interface AgentProfile {
  id: string;
  label: string;
  prompt: string;
}

const AGENTS_DIR = path.join(process.cwd(), 'agents');

const isMarkdownFile = (file: string) => file.toLowerCase().endsWith('.md');

const extractLabel = (content: string, fallback: string) => {
  const lines = content.split(/\r?\n/);
  const heading = lines.find(line => line.trim().startsWith('#'));
  if (!heading) {
    return fallback;
  }

  return heading.replace(/^#+\s*/, '').trim() || fallback;
};

async function ensureAgentsDir() {
  await fs.mkdir(AGENTS_DIR, { recursive: true });
}

async function readAgents(): Promise<AgentProfile[]> {
  await ensureAgentsDir();
  const entries = await fs.readdir(AGENTS_DIR);
  const agents: AgentProfile[] = [];

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) {
      continue;
    }

    const filePath = path.join(AGENTS_DIR, entry);
    const prompt = await fs.readFile(filePath, 'utf8');
    const id = path.basename(entry, path.extname(entry));
    const label = extractLabel(prompt, id);
    agents.push({ id, label, prompt });
  }

  agents.sort((a, b) => a.label.localeCompare(b.label));
  return agents;
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    || 'agent';
}

export async function GET() {
  try {
    const agents = await readAgents();
    return NextResponse.json({ agents });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to read agent profiles.',
      },
      { status: 500 }
    );
  }
}

interface CreateAgentBody {
  label: string;
  prompt: string;
}

export async function POST(request: Request) {
  let body: CreateAgentBody;

  try {
    body = (await request.json()) as CreateAgentBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const label = body?.label?.trim();
  const prompt = body?.prompt?.trim();

  if (!label) {
    return NextResponse.json({ error: 'Agent name is required.' }, { status: 400 });
  }

  if (!prompt) {
    return NextResponse.json({ error: 'Agent prompt is required.' }, { status: 400 });
  }

  try {
    await ensureAgentsDir();
    let slug = slugify(label);
    let candidate = slug;
    let counter = 1;

    while (true) {
      const filePath = path.join(AGENTS_DIR, `${candidate}.md`);
      try {
        await fs.access(filePath);
        counter += 1;
        candidate = `${slug}-${counter}`;
      } catch {
        slug = candidate;
        break;
      }
    }

    const filePath = path.join(AGENTS_DIR, `${slug}.md`);
    const content = prompt.startsWith('#') ? prompt : `# ${label}\n\n${prompt}`;
    await fs.writeFile(filePath, content, 'utf8');

    const agents = await readAgents();
    return NextResponse.json({ agents, createdId: slug });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to create agent profile.',
      },
      { status: 500 }
    );
  }
}
