import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { db } from '@/lib/db';
import { aiConversations, aiMessages } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { streamChatCompletion, getApiKey, getPreferredModel, OpenRouterMessage } from '@/lib/ai/openrouter';
import { buildSystemContext } from '@/lib/ai/context';

async function getUserId() {
  const hdrs = await headers();
  const apiKey = await validateApiKey(hdrs.get('authorization'));
  if (apiKey) return apiKey.userId;
  const { session } = await requireSession();
  return session?.user?.id ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { conversationId } = await params;

  const conv = await db.query.aiConversations.findFirst({
    where: and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)),
  });
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { content } = body;
  if (!content?.trim()) {
    return NextResponse.json({ error: 'Message content is required' }, { status: 400 });
  }

  // Save user message
  await db.insert(aiMessages).values({
    conversationId,
    role: 'user',
    content,
  });

  // Build context + conversation history (last 20 messages)
  const history = await db.query.aiMessages.findMany({
    where: eq(aiMessages.conversationId, conversationId),
    orderBy: [asc(aiMessages.createdAt)],
  });

  const systemContext = await buildSystemContext(userId);
  const apiKey = await getApiKey(userId);
  if (!apiKey) {
    return NextResponse.json(
      { error: 'No OpenRouter API key configured. Please add one in Settings.' },
      { status: 400 }
    );
  }

  const model = conv.model ?? (await getPreferredModel(userId));
  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemContext },
    ...history.slice(-20).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  // Stream from OpenRouter
  let upstream: ReadableStream<Uint8Array>;
  try {
    upstream = await streamChatCompletion({ messages, model, apiKey });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  // Tee: one branch to client, one to accumulate for DB save
  const [clientStream, saveStream] = upstream.tee();

  // Accumulate and save (fire-and-forget)
  (async () => {
    try {
      const reader = saveStream.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE data lines
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const data = JSON.parse(line.slice(6));
            fullContent += data.choices?.[0]?.delta?.content ?? '';
          } catch {}
        }
      }
      if (fullContent) {
        await db.insert(aiMessages).values({
          conversationId,
          role: 'assistant',
          content: fullContent,
        });
        await db
          .update(aiConversations)
          .set({ updatedAt: new Date() })
          .where(eq(aiConversations.id, conversationId));
      }
    } catch {}
  })();

  return new Response(clientStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
