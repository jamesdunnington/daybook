'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Wrench, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';

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

function FilterChip({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Eye;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
        active ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-accent'
      )}
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
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
  const [open, setOpen] = useState(false);
  const [visionOnly, setVisionOnly] = useState(false);
  const [toolsOnly, setToolsOnly] = useState(false);
  const current = models.find((m) => m.id === value);

  const filtered = useMemo(
    () => models.filter((m) => (!visionOnly || m.supportsImages) && (!toolsOnly || m.supportsTools)),
    [models, visionOnly, toolsOnly]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn('justify-between font-normal', className)}
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {current?.supportsImages && <Eye className="size-3 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate text-left">
            {current?.name ?? (isLoading ? 'Loading models…' : value || 'Select a model')}
          </span>
          {current && !current.supportsTools && (
            <span
              className="flex shrink-0 items-center gap-0.5 rounded bg-destructive/10 px-1 py-0.5 text-[10px] text-destructive"
              title="This model can't use app tools — it can only chat, not act on your data"
            >
              <Wrench className="size-2.5" />
              no actions
            </span>
          )}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <Command shouldFilter>
          <CommandInput placeholder="Search models…" />
          <div className="flex gap-1.5 border-b px-1.5 py-1.5">
            <FilterChip active={visionOnly} onClick={() => setVisionOnly((v) => !v)} icon={Eye} label="Vision" />
            <FilterChip active={toolsOnly} onClick={() => setToolsOnly((v) => !v)} icon={Wrench} label="Tools" />
          </div>
          <CommandList className="max-h-72">
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.name} ${m.id}`}
                  onSelect={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('size-3.5 shrink-0', value === m.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex w-full min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {m.supportsImages && <Eye className="size-3 shrink-0 text-muted-foreground" />}
                      {!m.supportsTools && <Wrench className="size-3 shrink-0 text-muted-foreground/50" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                    </span>
                    <span className="truncate pl-[18px] text-xs text-muted-foreground">
                      {formatPrice(m.promptPricePerM)} in · {formatPrice(m.completionPricePerM)} out
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
