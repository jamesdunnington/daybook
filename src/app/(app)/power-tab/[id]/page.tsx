'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { Plus, Trash2, FileText, Target, Pencil, Check, X } from 'lucide-react';
import { undoableDelete } from '@/lib/power-tab/undo-toast';
import { useConfirm } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { BlockEditor } from '@/components/power-tab/block-editor';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  description: string | null;
}

interface LogEntry {
  id: string;
  content: string;
  entryDate: string;
  milestoneId: string | null;
  countValue: string;
}

interface Forecast {
  progressSoFar: number;
  targetCount: number;
  percentComplete: number;
  remaining: number;
  pacePerDay: number | null;
  forecastDate: string | null;
  note: string;
}

interface Milestone {
  id: string;
  title: string;
  unitLabel: string;
  targetCount: string;
  targetDate: string | null;
  forecast: Forecast;
}

interface PageSummary {
  id: string;
  title: string;
  parentId: string | null;
  position: number;
}

interface PageDetail extends PageSummary {
  content: unknown[];
}

const jsonHeaders = { 'Content-Type': 'application/json' };

// ─── Activity tab ───────────────────────────────────────────────────────────

function LogEntryRow({
  entry,
  projectId,
}: {
  entry: LogEntry;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);

  const editMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/power-tab/projects/${projectId}/log/${entry.id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ content: draft }),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to update entry');
        return r.json();
      }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['power-tab-log', projectId] });
    },
    onError: () => toast.error('Failed to update entry'),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/power-tab/projects/${projectId}/log/${entry.id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error('Failed to delete entry');
        return r.json();
      }),
    onSuccess: (data: { undoId?: string; undoExpiresAt?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['power-tab-log', projectId] });
      undoableDelete('Log entry deleted', data.undoId, data.undoExpiresAt);
    },
    onError: () => toast.error('Failed to delete entry'),
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
          {format(new Date(entry.entryDate), 'MMM d, yyyy')} ·{' '}
          {formatDistanceToNow(new Date(entry.entryDate), { addSuffix: true })}
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

function ActivityTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');

  const { data: entries = [] } = useQuery<LogEntry[]>({
    queryKey: ['power-tab-log', projectId],
    queryFn: () => fetch(`/api/power-tab/projects/${projectId}/log`).then((r) => r.json()),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/power-tab/projects/${projectId}/log`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ content }),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to log activity');
        return r.json();
      }),
    onSuccess: () => {
      setContent('');
      queryClient.invalidateQueries({ queryKey: ['power-tab-log', projectId] });
    },
    onError: () => toast.error('Failed to log activity'),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="What did you do? (e.g. expanded article X to 2k words)"
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

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No activity logged yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <LogEntryRow key={entry.id} entry={entry} projectId={projectId} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Milestones tab ─────────────────────────────────────────────────────────

function MilestoneDialog({
  projectId,
  milestone,
  trigger,
}: {
  projectId: string;
  milestone?: Milestone;
  trigger: React.ReactElement;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!milestone;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [unitLabel, setUnitLabel] = useState(milestone?.unitLabel ?? 'items');
  const [targetCount, setTargetCount] = useState(milestone?.targetCount ?? '');
  const [targetDate, setTargetDate] = useState(milestone?.targetDate?.slice(0, 10) ?? '');

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch(
        isEdit
          ? `/api/power-tab/projects/${projectId}/milestones/${milestone!.id}`
          : `/api/power-tab/projects/${projectId}/milestones`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            title,
            unitLabel,
            targetCount: Number(targetCount),
            targetDate: targetDate || null,
          }),
        }
      ).then((r) => {
        if (!r.ok) throw new Error(isEdit ? 'Failed to update milestone' : 'Failed to create milestone');
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['power-tab-milestones', projectId] });
      toast.success(isEdit ? 'Milestone updated' : 'Milestone created');
      setOpen(false);
      if (!isEdit) {
        setTitle('');
        setTargetCount('');
        setTargetDate('');
      }
    },
    onError: () => toast.error(isEdit ? 'Failed to update milestone' : 'Failed to create milestone'),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && isEdit) {
          setTitle(milestone!.title);
          setUnitLabel(milestone!.unitLabel);
          setTargetCount(milestone!.targetCount);
          setTargetDate(milestone!.targetDate?.slice(0, 10) ?? '');
        }
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit milestone' : 'New milestone'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Title (e.g. Expand 50 articles)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              placeholder="Target count"
              value={targetCount}
              onChange={(e) => setTargetCount(e.target.value)}
            />
            <Input placeholder="Unit (e.g. articles)" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} />
          </div>
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
        <DialogFooter>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!title.trim() || !targetCount || saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MilestonesTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ['power-tab-milestones', projectId],
    queryFn: () => fetch(`/api/power-tab/projects/${projectId}/milestones`).then((r) => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (milestoneId: string) =>
      fetch(`/api/power-tab/projects/${projectId}/milestones/${milestoneId}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error('Failed to delete milestone');
        return r.json();
      }),
    onSuccess: (data: { undoId?: string; undoExpiresAt?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['power-tab-milestones', projectId] });
      undoableDelete('Milestone deleted', data.undoId, data.undoExpiresAt);
    },
    onError: () => toast.error('Failed to delete milestone'),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <MilestoneDialog
          projectId={projectId}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New milestone
            </Button>
          }
        />
      </div>

      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No milestones yet.</p>
      ) : (
        <ul className="space-y-3">
          {milestones.map((m) => (
            <li key={m.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium">{m.title}</span>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <MilestoneDialog
                    projectId={projectId}
                    milestone={m}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        aria-label={`Edit milestone ${m.title}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMutation.mutate(m.id)}
                    aria-label={`Delete milestone ${m.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(m.forecast.percentComplete, 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {m.forecast.progressSoFar} / {m.forecast.targetCount} {m.unitLabel}
                </span>
                <Badge variant="outline">{m.forecast.percentComplete.toFixed(0)}%</Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                {m.forecast.forecastDate
                  ? `${m.forecast.note} Forecast finish: ${format(new Date(m.forecast.forecastDate), 'MMM d, yyyy')}.`
                  : m.forecast.note}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Pages tab ──────────────────────────────────────────────────────────────

function PagesTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: pages = [] } = useQuery<PageSummary[]>({
    queryKey: ['power-tab-pages', projectId],
    queryFn: () => fetch(`/api/power-tab/projects/${projectId}/pages`).then((r) => r.json()),
  });

  const { data: page } = useQuery<PageDetail>({
    queryKey: ['power-tab-page', selectedId],
    queryFn: () => fetch(`/api/power-tab/pages/${selectedId}`).then((r) => r.json()),
    enabled: !!selectedId,
  });

  const createPageMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/power-tab/projects/${projectId}/pages`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title: 'Untitled' }),
      }).then((r) => r.json()),
    onSuccess: (newPage: PageSummary) => {
      queryClient.invalidateQueries({ queryKey: ['power-tab-pages', projectId] });
      setSelectedId(newPage.id);
    },
    onError: () => toast.error('Failed to create page'),
  });

  const saveMutation = useMutation({
    mutationFn: (content: unknown[]) =>
      fetch(`/api/power-tab/pages/${selectedId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ content }),
      }),
    onError: () => toast.error('Failed to save page'),
  });

  const renameMutation = useMutation({
    mutationFn: (title: string) =>
      fetch(`/api/power-tab/pages/${selectedId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ title }),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to rename page');
        return r.json();
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['power-tab-pages', projectId] }),
    onError: () => toast.error('Failed to rename page'),
  });

  const confirm = useConfirm();
  const deletePageMutation = useMutation({
    mutationFn: (pageId: string) =>
      fetch(`/api/power-tab/pages/${pageId}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error('Failed to delete page');
        return r.json();
      }),
    onSuccess: (data: { undoId?: string; undoExpiresAt?: string }, pageId) => {
      queryClient.invalidateQueries({ queryKey: ['power-tab-pages', projectId] });
      if (selectedId === pageId) setSelectedId(null);
      undoableDelete('Page deleted', data.undoId, data.undoExpiresAt);
    },
    onError: () => toast.error('Failed to delete page'),
  });

  const rootPages = useMemo(() => pages.filter((p) => !p.parentId), [pages]);
  const childrenOf = (parentId: string) => pages.filter((p) => p.parentId === parentId);

  async function handleDeletePage(p: PageSummary) {
    const childCount = childrenOf(p.id).length;
    if (childCount > 0) {
      const ok = await confirm({
        title: `Delete "${p.title}"?`,
        description: `It has ${childCount} sub-page${childCount === 1 ? '' : 's'} that will be deleted too, and Undo can't bring them back.`,
        confirmLabel: 'Delete all',
      });
      if (!ok) return;
    }
    deletePageMutation.mutate(p.id);
  }

  function renderTree(items: PageSummary[], depth: number) {
    return items.map((p) => (
      <div key={p.id} className="group/row">
        <div
          className={`flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent ${
            selectedId === p.id ? 'bg-accent' : ''
          }`}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          <button
            onClick={() => setSelectedId(p.id)}
            className={`flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left text-sm ${
              selectedId === p.id ? 'font-medium' : ''
            }`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{p.title}</span>
          </button>
          <button
            onClick={() => handleDeletePage(p)}
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover/row:opacity-100"
            aria-label={`Delete page ${p.title}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {renderTree(childrenOf(p.id), depth + 1)}
      </div>
    ));
  }

  return (
    <div className="grid gap-4 md:grid-cols-[200px_1fr]">
      <div className="space-y-1">
        <Button variant="outline" size="sm" className="w-full" onClick={() => createPageMutation.mutate()}>
          <Plus className="h-3.5 w-3.5" />
          New page
        </Button>
        <div className="mt-2">{renderTree(rootPages, 0)}</div>
        {pages.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4">No pages yet.</p>
        )}
      </div>

      <div className="space-y-2">
        {selectedId && page ? (
          <>
            <Input
              defaultValue={page.title}
              key={page.id}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== page.title) {
                  renameMutation.mutate(e.target.value.trim());
                }
              }}
              className="font-medium"
            />
            <BlockEditor
              pageId={page.id}
              initialContent={(page.content ?? []) as never}
              onSave={(content) => saveMutation.mutate(content)}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">Select or create a page.</p>
        )}
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const { data: project } = useQuery<Project>({
    queryKey: ['power-tab-project', projectId],
    queryFn: () => fetch(`/api/power-tab/projects/${projectId}`).then((r) => r.json()),
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{project?.name ?? 'Loading…'}</h1>
        {project?.description && <p className="text-sm text-muted-foreground mt-1">{project.description}</p>}
      </div>

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
        </TabsList>
        <TabsContent value="activity"><ActivityTab projectId={projectId} /></TabsContent>
        <TabsContent value="milestones"><MilestonesTab projectId={projectId} /></TabsContent>
        <TabsContent value="pages"><PagesTab projectId={projectId} /></TabsContent>
      </Tabs>
    </div>
  );
}
