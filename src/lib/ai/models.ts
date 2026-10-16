// OpenRouter model catalog: price per 1M tokens + capability flags (vision, tool-calling),
// cached in-memory since this is a single-instance Docker deployment (same pattern as the
// Telegram bot's pendingLinks map).

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number | null;
  promptPricePerM: number | null;
  completionPricePerM: number | null;
  supportsImages: boolean;
  supportsTools: boolean;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
}

const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: { at: number; models: ModelInfo[] } | null = null;

function toPerMillion(raw?: string): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return n * 1_000_000;
}

export async function getModelCatalog(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models;

  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) {
    if (cache) return cache.models; // serve stale rather than fail
    throw new Error(`Failed to fetch OpenRouter model catalog: ${res.status}`);
  }
  const data = (await res.json()) as { data: OpenRouterModel[] };

  const models = data.data.map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    contextLength: m.context_length ?? null,
    promptPricePerM: toPerMillion(m.pricing?.prompt),
    completionPricePerM: toPerMillion(m.pricing?.completion),
    supportsImages: m.architecture?.input_modalities?.includes('image') ?? false,
    supportsTools: m.supported_parameters?.includes('tools') ?? false,
  }));

  cache = { at: Date.now(), models };
  return models;
}

export async function getModelInfo(modelId: string): Promise<ModelInfo | null> {
  const models = await getModelCatalog();
  return models.find((m) => m.id === modelId) ?? null;
}
