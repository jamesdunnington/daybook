import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { journalEntries, journalPhotos } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId =
    apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const entry = await db.query.journalEntries.findFirst({
    where: and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)),
  });

  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const photos = await db
    .select()
    .from(journalPhotos)
    .where(eq(journalPhotos.entryId, id))
    .orderBy(journalPhotos.sortOrder);

  return NextResponse.json({ ...entry, photos });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId =
    apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const existing = await db.query.journalEntries.findFirst({
    where: and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)),
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: {
    title?: string | null;
    content?: string;
    mood?: string | null;
    tags?: string[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: {
    updatedAt: Date;
    title?: string | null;
    content?: string;
    mood?: string | null;
    tags?: string[];
  } = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.content !== undefined) updates.content = body.content;
  if (body.mood !== undefined) updates.mood = body.mood;
  if (body.tags !== undefined) updates.tags = body.tags;

  const [updated] = await db
    .update(journalEntries)
    .set(updates)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId =
    apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const existing = await db.query.journalEntries.findFirst({
    where: and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)),
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Fetch photos to delete files
  const photos = await db
    .select()
    .from(journalPhotos)
    .where(eq(journalPhotos.entryId, id));

  // Delete photo files from disk (fire and forget each unlink so one failure doesn't block)
  for (const photo of photos) {
    const filePath = path.join(UPLOAD_DIR, 'journal', userId, photo.filename);
    await fs.unlink(filePath).catch(() => {});
  }

  // Cascade deletes photos via DB constraint
  await db
    .delete(journalEntries)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)));

  return NextResponse.json({ success: true });
}
