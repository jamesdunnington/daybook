import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { db } from '@/lib/db';
import { aiConversations, aiMessages } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';

async function getUserId() {
  const hdrs = await headers();
  const apiKey = await validateApiKey(hdrs.get('authorization'));
  if (apiKey) return apiKey.userId;
  const { session } = await requireSession();
  return session?.user?.id ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { conversationId } = await params;

  const conv = await db.query.aiConversations.findFirst({
    where: and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)),
  });
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const messages = await db.query.aiMessages.findMany({
    where: eq(aiMessages.conversationId, conversationId),
    orderBy: [asc(aiMessages.createdAt)],
  });

  return NextResponse.json({ ...conv, messages });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { conversationId } = await params;

  const conv = await db.query.aiConversations.findFirst({
    where: and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)),
  });
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const updates: { model?: string; title?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (typeof body.model === 'string') updates.model = body.model;
  if (typeof body.title === 'string') updates.title = body.title;

  const [updated] = await db
    .update(aiConversations)
    .set(updates)
    .where(eq(aiConversations.id, conversationId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { conversationId } = await params;

  const conv = await db.query.aiConversations.findFirst({
    where: and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)),
  });
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.delete(aiConversations).where(eq(aiConversations.id, conversationId));
  return NextResponse.json({ success: true });
}
