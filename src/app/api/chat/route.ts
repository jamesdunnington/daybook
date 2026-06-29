import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { db } from '@/lib/db';
import { aiConversations } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

async function getUserId() {
  const hdrs = await headers();
  const apiKey = await validateApiKey(hdrs.get('authorization'));
  if (apiKey) return apiKey.userId;
  const { session } = await requireSession();
  return session?.user?.id ?? null;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const convs = await db.query.aiConversations.findMany({
    where: eq(aiConversations.userId, userId),
    orderBy: [desc(aiConversations.updatedAt)],
  });
  return NextResponse.json(convs);
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const [conv] = await db
    .insert(aiConversations)
    .values({
      userId,
      title: body.title ?? 'New Chat',
      model: body.model ?? 'openai/gpt-4o-mini',
    })
    .returning();

  return NextResponse.json(conv, { status: 201 });
}
