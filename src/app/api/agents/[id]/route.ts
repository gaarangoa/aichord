import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

const AGENTS_DIR = path.join(process.cwd(), 'agents');

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const slug = params.id;
  if (!slug) {
    return NextResponse.json({ error: 'Agent id is required.' }, { status: 400 });
  }

  try {
    const filePath = path.join(AGENTS_DIR, `${slug}.md`);
    const prompt = await fs.readFile(filePath, 'utf8');
    return NextResponse.json({ id: slug, prompt });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to read agent profile.',
      },
      { status: 404 }
    );
  }
}
