import { db } from '@/lib/db';
import { userSettings, appSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function getApiKey(userId: string): Promise<string | null> {
  // 1. Per-user key
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  if (settings?.openrouterApiKey) return settings.openrouterApiKey;

  // 2. Global admin key
  const global = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, 'global_openrouter_api_key'),
  });
  if (global?.value) return global.value;

  // 3. Env fallback
  return process.env.OPENROUTER_API_KEY ?? null;
}

export async function getPreferredModel(userId: string): Promise<string> {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  return settings?.preferredModel ?? 'openai/gpt-4o-mini';
}

export type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenRouterContentPart[] | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

export interface OpenRouterTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export async function streamChatCompletion(params: {
  messages: OpenRouterMessage[];
  model: string;
  apiKey: string;
}): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
      'X-Title': 'Daybook',
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${text}`);
  }

  return response.body!;
}

export async function chatCompletion(params: {
  messages: OpenRouterMessage[];
  model: string;
  apiKey: string;
}): Promise<string> {
  const message = await chatCompletionMessage(params);
  return message.content ?? '';
}

export async function chatCompletionMessage(params: {
  messages: OpenRouterMessage[];
  model: string;
  apiKey: string;
  tools?: OpenRouterTool[];
}): Promise<{ content: string | null; tool_calls?: OpenRouterToolCall[] }> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
      'X-Title': 'Daybook',
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      ...(params.tools?.length ? { tools: params.tools } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message ?? {};
  return { content: message.content ?? null, tool_calls: message.tool_calls };
}

/** Wraps already-fetched text as a single-chunk OpenAI-style SSE stream, so callers that
 * must run a non-streaming tool loop can still hand the client the same SSE shape the
 * plain streaming path produces. */
export function textToSSEStream(text: string, meta?: Record<string, unknown>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const chunk = { choices: [{ delta: { content: text } }] };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      if (meta) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ daybook_meta: meta })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}
