'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { undoableDelete } from '@/lib/power-tab/undo-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  type LogEntry,
  type Milestone,
  dayString,
  formatDay,
  jsonHeaders,
  readError,
  todayString,
  useRefreshPowerTab,
} from './shared';

/** One planned target: checkbox, name, its own target date (optional). */
function ItemRow({
  item,
  milestone,
  projectId,
}: {
  item: LogEntry;
  milestone: Milestone;
  projectId: string;
}) {
  const refresh = useRefreshPowerTab(projectId);
  const abandoned = milestone.status === 'abandoned';
  const done = !!item.completedAt;
  const due = item.targetDate ?? milestone.targetDate;
  const overdue = !done && !abandoned && !!due && dayString(due) < todayString();
  const count = parseFloat(item.countValue);

  const patchMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch(`/api/power-tab/projects/${projectId}/log/${item.id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r, 'Failed to update target'));
        return r.json();
      }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/power-tab/projects/${projectId}/log/${item.id}`, { method: 'DELETE' }).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r, 'Failed to delete target'));
        return r.json();
      }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  let caption: React.ReactNode;
  if (done) {
    caption = `Done ${format(new Date(item.completedAt!), 'MMM d, yyyy')}`;
  } else if (overdue) {
    caption = <span className="text-destructive">Overdue · was due {formatDay(due!, 'MMM d')}</span>;
  } else if (!item.targetDate && milestone.targetDate) {
    caption = `Open · due with milestone, ${formatDay(milestone.targetDate, 'MMM d')}`;
  } else if (item.targetDate) {
    caption = `Due ${formatDay(item.targetDate, 'MMM d')}`;
  }

  return (
    <li className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${abandoned ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={done}
        disabled={abandoned || patchMutation.isPending}
        onChange={(e) => patchMutation.mutate({ completed: e.target.checked })}
        aria-label={`Mark ${item.content || 'target'} ${done ? 'not done' : 'done'}`}
        className="mt-2 h-4 w-4 shrink-0 accent-primary"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <Input
          key={item.content}
          defaultValue={item.content}
          placeholder="Name this target"
          disabled={abandoned}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value !== item.content) patchMutation.mutate({ content: value });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className={`h-8 ${done ? 'text-muted-foreground line-through' : ''}`}
        />
        <p className="px-1 text-xs text-muted-foreground">
          {caption}
          {count !== 1 && ` · counts as ${count}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Input
          type="date"
          value={item.targetDate ? dayString(item.targetDate) : ''}
          disabled={abandoned || done}
          onChange={(e) => patchMutation.mutate({ targetDate: e.target.value || null })}
          aria-label={`Target date for ${item.content || 'this target'} (leave empty to follow the milestone)`}
          title="Target date — clear it to follow the milestone's date"
          className="h-8 w-36"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          disabled={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
          aria-label={`Delete target: ${item.content || 'untitled'}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

function MilestoneSection({
  milestone,
  items,
  projectId,
}: {
  milestone: Milestone;
  items: LogEntry[];
  projectId: string;
}) {
  const refresh = useRefreshPowerTab(projectId);
  const [name, setName] = useState('');
  const abandoned = milestone.status === 'abandoned';

  const addMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/power-tab/projects/${projectId}/log`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ planned: true, milestoneId: milestone.id, content: name }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r, 'Failed to add target'));
        return r.json();
      }),
    onSuccess: () => {
      setName('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <section className={`space-y-2 ${abandoned ? 'opacity-60 grayscale' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{milestone.title}</h3>
          {abandoned && <Badge variant="outline">Abandoned</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {milestone.forecast.progressSoFar} / {milestone.forecast.targetCount} {milestone.unitLabel}
          {milestone.targetDate && ` · due ${formatDay(milestone.targetDate, 'MMM d, yyyy')}`}
        </p>
      </div>

      {sorted.length > 0 && (
        <ul className="space-y-2">
          {sorted.map((item) => (
            <ItemRow key={item.id} item={item} milestone={milestone} projectId={projectId} />
          ))}
        </ul>
      )}

      {!abandoned && (
        <div className="flex gap-2">
          <Input
            placeholder="Add another target (name optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addMutation.mutate();
            }}
            className="h-8"
          />
          <Button size="sm" variant="outline" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
            <Plus className="h-4 w-4" />
            Add target
          </Button>
        </div>
      )}
    </section>
  );
}

/** A finished one-off with no milestone: just a dated line. */
function PlainEntryRow({ entry, projectId }: { entry: LogEntry; projectId: string }) {
  const refresh = useRefreshPowerTab(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);

  const editMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/power-tab/projects/${projectId}/log/${entry.id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ content: draft }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r, 'Failed to update entry'));
        return r.json();
      }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/power-tab/projects/${projectId}/log/${entry.id}`, { method: 'DELETE' }).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r, 'Failed to delete entry'));
        return r.json();
      }),
    onSuccess: (data: { undoId?: string; undoExpiresAt?: string }) => {
      refresh();
      undoableDelete('Log entry deleted', data.undoId, data.undoExpiresAt);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing) {
    return (
      <li className="flex items-center gap-2 rounded-lg border px-3 py-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) editMutation.mutate();
            if (e.key === 'Escape') setEditing(false);
          }}
          autoFocus
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => editMutation.mutate()}
          disabled={!draft.trim() || editMutation.isPending}
          aria-label="Save edit"
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setEditing(false)}
          aria-label="Cancel edit"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm">{entry.content}</p>
        <p className="text-xs text-muted-foreground">
          {format(new Date(entry.entryDate), 'MMM d, yyyy')}
        </p>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setDraft(entry.content);
            setEditing(true);
          }}
          aria-label={`Edit log entry: ${entry.content}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => deleteMutation.mutate()}
          aria-label={`Delete log entry: ${entry.content}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

export function ActivityTab({ projectId }: { projectId: string }) {
  const refresh = useRefreshPowerTab(projectId);
  const [content, setContent] = useState('');

  const { data: entries = [] } = useQuery<LogEntry[]>({
    queryKey: ['power-tab-log', projectId],
    queryFn: () => fetch(`/api/power-tab/projects/${projectId}/log`).then((r) => r.json()),
  });

  // The API already lists abandoned milestones last.
  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ['power-tab-milestones', projectId],
    queryFn: () => fetch(`/api/power-tab/projects/${projectId}/milestones`).then((r) => r.json()),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/power-tab/projects/${projectId}/log`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ content }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r, 'Failed to log activity'));
        return r.json();
      }),
    onSuccess: () => {
      setContent('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const plain = entries.filter((e) => !e.milestoneId);
  const hasAnything = milestones.length > 0 || plain.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Input
          placeholder="Log something you did (one-off, not part of a milestone)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && content.trim()) addMutation.mutate();
          }}
        />
        <Button onClick={() => addMutation.mutate()} disabled={!content.trim() || addMutation.isPending}>
          <Plus className="h-4 w-4" />
          Log
        </Button>
      </div>

      {!hasAnything && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing here yet. Create a milestone and its targets will show up here to tick off.
        </p>
      )}

      {milestones.map((m) => (
        <MilestoneSection
          key={m.id}
          milestone={m}
          items={entries.filter((e) => e.milestoneId === m.id)}
          projectId={projectId}
        />
      ))}

      {plain.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Other activity</h3>
          <ul className="space-y-2">
            {plain.map((entry) => (
              <PlainEntryRow key={entry.id} entry={entry} projectId={projectId} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
