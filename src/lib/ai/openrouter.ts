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

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}
