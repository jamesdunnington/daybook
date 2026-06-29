import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { journalEntries } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { headers } from 'next/headers';
import { eq, and, gte, lte, desc, arrayContains } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId =
    apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month'); // YYYY-MM
  const tag = searchParams.get('tag');

  const conditions = [eq(journalEntries.userId, userId)];

  if (month) {
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1);
    conditions.push(gte(journalEntries.entryDate, start));
    conditions.push(lte(journalEntries.entryDate, end));
  }

  if (tag) {
    conditions.push(arrayContains(journalEntries.tags, [tag]));
  }

  const entries = await db
    .select()
    .from(journalEntries)
    .where(and(...conditions))
    .orderBy(desc(journalEntries.entryDate));

  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId =
    apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    title?: string;
    content: string;
    mood?: string;
    tags?: string[];
    entryDate?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const entryDate = body.entryDate ? new Date(body.entryDate) : new Date();

  const [entry] = await db
    .insert(journalEntries)
    .values({
      userId,
      title: body.title ?? null,
      content: body.content ?? '',
      mood: body.mood ?? null,
      tags: body.tags ?? [],
      entryDate,
    })
    .returning();

  return NextResponse.json(entry, { status: 201 });
}
