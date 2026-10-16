'use client';

import { useQuery } from '@tanstack/react-query';
import { Eye, Wrench } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number | null;
  promptPricePerM: number | null;
  completionPricePerM: number | null;
  supportsImages: boolean;
  supportsTools: boolean;
}

async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch('/api/ai/models');
  if (!res.ok) throw new Error('Failed to load models');
  return res.json();
}

function formatPrice(p: number | null): string {
  if (p == null) return '—';
  if (p === 0) return 'free';
  return `$${p < 1 ? p.toFixed(3) : p.toFixed(2)}/M`;
}

export function useModelCatalog() {
  return useQuery<ModelInfo[]>({
    queryKey: ['openrouter-models'],
    queryFn: fetchModels,
    staleTime: 60 * 60 * 1000,
  });
}

export function ModelPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const { data: models = [], isLoading } = useModelCatalog();
  const current = models.find((m) => m.id === value);

  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v as string)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={isLoading ? 'Loading models…' : value}>
          <span className="flex min-w-0 items-center gap-1.5">
            {current?.supportsImages && <Eye className="size-3 shrink-0 text-muted-foreground" />}
            <span className="truncate">{current?.name ?? value}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {models.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <span className="flex w-full min-w-0 items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5">
                {m.supportsImages && <Eye className="size-3 shrink-0 text-muted-foreground" />}
                {!m.supportsTools && <Wrench className="size-3 shrink-0 text-muted-foreground/50" />}
                <span className="truncate">{m.name}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatPrice(m.promptPricePerM)} in · {formatPrice(m.completionPricePerM)} out
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
