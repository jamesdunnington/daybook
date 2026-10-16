import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { db } from '@/lib/db';
import { aiConversations, aiMessages } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import {
  streamChatCompletion,
  chatCompletionMessage,
  textToSSEStream,
  getApiKey,
  getPreferredModel,
  OpenRouterMessage,
  OpenRouterContentPart,
} from '@/lib/ai/openrouter';
import { buildSystemContext } from '@/lib/ai/context';
import { getModelInfo } from '@/lib/ai/models';
import { TOOL_SPECS, executeTool, ToolCtx, ToolRunResult } from '@/lib/ai/tools';
import fs from 'fs/promises';
import path from 'path';

async function getUserId() {
  const hdrs = await headers();
  const apiKey = await validateApiKey(hdrs.get('authorization'));
  if (apiKey) return apiKey.userId;
  const { session } = await requireSession();
  return session?.user?.id ?? null;
}

interface ImageAttachmentInput {
  uploadId: string;
  filename: string;
  storedFilename: string;
  mimeType: string;
  url: string;
}

const MAX_TOOL_ITERATIONS = 6;
const STORED_FILENAME_RE = /^[a-f0-9-]+\.[a-z0-9]+$/i;

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
  const { content, images } = body as { content?: string; images?: ImageAttachmentInput[] };
  const safeImages = (images ?? []).filter((img) => STORED_FILENAME_RE.test(img.storedFilename));
  if (!content?.trim() && !safeImages.length) {
    return NextResponse.json({ error: 'Message content is required' }, { status: 400 });
  }

  // Save user message
  await db.insert(aiMessages).values({
    conversationId,
    role: 'user',
    content: content ?? '',
    attachments: safeImages.length
      ? safeImages.map((img) => ({
          filename: img.filename,
          type: 'image' as const,
          mimeType: img.mimeType,
          uploadId: img.uploadId,
          url: img.url,
        }))
      : undefined,
  });

  // Build context + conversation history (last 20 prior messages)
  const history = await db.query.aiMessages.findMany({
    where: eq(aiMessages.conversationId, conversationId),
    orderBy: [asc(aiMessages.createdAt)],
  });
  const priorHistory = history.slice(0, -1).slice(-20); // excludes the message just inserted above

  const systemContext = await buildSystemContext(userId);
  const apiKey = await getApiKey(userId);
  if (!apiKey) {
    return NextResponse.json(
      { error: 'No OpenRouter API key configured. Please add one in Settings.' },
      { status: 400 }
    );
  }

  const model = conv.model ?? (await getPreferredModel(userId));
  const modelInfo = await getModelInfo(model).catch(() => null);
  const supportsTools = modelInfo?.supportsTools ?? false;
  const supportsImages = modelInfo?.supportsImages ?? false;

  // Load any attached image bytes — used both as multimodal input (if the model can see
  // images) and as raw bytes tools like attach_photo_to_journal_entry can forward on.
  const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
  const pendingUploads = new Map<string, { buffer: Buffer; mimeType: string; filename: string }>();
  const imageParts: OpenRouterContentPart[] = [];
  for (const img of safeImages) {
    try {
      const filePath = path.join(uploadDir, 'chat-images', userId, img.storedFilename);
      const buf = await fs.readFile(filePath);
      pendingUploads.set(img.uploadId, { buffer: buf, mimeType: img.mimeType, filename: img.filename });
      if (supportsImages) {
        imageParts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${buf.toString('base64')}` } });
      }
    } catch {
      // Missing file on disk — skip it silently, the model just won't see it.
    }
  }

  const warningNote =
    safeImages.length && !supportsImages
      ? `\n\n[Note: the currently selected model (${model}) cannot read images. Tell the user to pick a vision-capable model from the model picker to use photo features.]`
      : '';

  const userMessageForModel: OpenRouterMessage = {
    role: 'user',
    content: imageParts.length
      ? [{ type: 'text', text: content?.trim() || 'See attached image.' }, ...imageParts]
      : content ?? '',
  };

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemContext + warningNote },
    ...priorHistory.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    userMessageForModel,
  ];

  // ── Models without tool-calling support: unchanged plain streaming path ──
  if (!supportsTools) {
    let upstream: ReadableStream<Uint8Array>;
    try {
      upstream = await streamChatCompletion({ messages, model, apiKey });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }

    const [clientStream, saveStream] = upstream.tee();

    (async () => {
      try {
        const reader = saveStream.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
            try {
              const data = JSON.parse(line.slice(6));
              fullContent += data.choices?.[0]?.delta?.content ?? '';
            } catch {}
          }
        }
        if (fullContent) {
          await db.insert(aiMessages).values({ conversationId, role: 'assistant', content: fullContent });
          await db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversationId));
        }
      } catch {}
    })();

    return new Response(clientStream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  // ── Tool-calling loop: auto-executes every tool call, no confirmation gate ──
  const ctx: ToolCtx = {
    origin: req.nextUrl.origin,
    cookieHeader: req.headers.get('cookie') ?? '',
    userId,
    conversationId,
    pendingUploads,
  };

  const toolLog: Array<{ name: string; summary: string; undoId?: string; undoExpiresAt?: string }> = [];
  let finalText = '';

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const resp = await chatCompletionMessage({ messages, model, apiKey, tools: TOOL_SPECS });

      if (resp.tool_calls?.length) {
        messages.push({ role: 'assistant', content: resp.content, tool_calls: resp.tool_calls });

        for (const call of resp.tool_calls) {
          let result: ToolRunResult;
          try {
            const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
            result = await executeTool(call.function.name, args, ctx);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result = { output: { error: message }, summary: `Failed: ${call.function.name} (${message})` };
          }
          toolLog.push({
            name: call.function.name,
            summary: result.summary,
            undoId: result.undoId,
            undoExpiresAt: result.undoExpiresAt,
          });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result.output ?? {}) });
        }
        continue;
      }

      finalText = resp.content ?? '';
      break;
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  if (!finalText && toolLog.length) {
    finalText = toolLog.map((t) => `✓ ${t.summary}`).join('\n');
  }

  await db.insert(aiMessages).values({
    conversationId,
    role: 'assistant',
    content: finalText,
    toolCalls: toolLog.length ? toolLog : undefined,
  });
  await db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversationId));

  return new Response(textToSSEStream(finalText, toolLog.length ? { toolCalls: toolLog } : undefined), {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
