'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { Plus, Trash2, FileText, Target } from 'lucide-react';
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

  const deleteMutation = useMutation({
    mutationFn: (entryId: string) =>
      fetch(`/api/power-tab/projects/${projectId}/log/${entryId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['power-tab-log', projectId] }),
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
            <li key={entry.id} className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm">{entry.content}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(entry.entryDate), 'MMM d, yyyy')} ·{' '}
                  {formatDistanceToNow(new Date(entry.entryDate), { addSuffix: true })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => deleteMutation.mutate(entry.id)}
                aria-label={`Delete log entry: ${entry.content}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Milestones tab ─────────────────────────────────────────────────────────

function NewMilestoneDialog({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [unitLabel, setUnitLabel] = useState('items');
  const [targetCount, setTargetCount] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/power-tab/projects/${projectId}/milestones`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          title,
          unitLabel,
          targetCount: Number(targetCount),
          targetDate: targetDate || undefined,
        }),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to create milestone');
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['power-tab-milestones', projectId] });
      toast.success('Milestone created');
      setOpen(false);
      setTitle('');
      setTargetCount('');
      setTargetDate('');
    },
    onError: () => toast.error('Failed to create milestone'),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="h-4 w-4" />
        New milestone
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New milestone</DialogTitle>
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
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || !targetCount || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating…' : 'Create'}
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
      fetch(`/api/power-tab/projects/${projectId}/milestones/${milestoneId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['power-tab-milestones', projectId] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NewMilestoneDialog projectId={projectId} />
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate(m.id)}
                  aria-label={`Delete milestone ${m.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
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

  const rootPages = useMemo(() => pages.filter((p) => !p.parentId), [pages]);
  const childrenOf = (parentId: string) => pages.filter((p) => p.parentId === parentId);

  function renderTree(items: PageSummary[], depth: number) {
    return items.map((p) => (
      <div key={p.id}>
        <button
          onClick={() => setSelectedId(p.id)}
          className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-accent ${
            selectedId === p.id ? 'bg-accent font-medium' : ''
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{p.title}</span>
        </button>
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

      <div>
        {selectedId && page ? (
          <BlockEditor
            pageId={page.id}
            initialContent={(page.content ?? []) as never}
            onSave={(content) => saveMutation.mutate(content)}
          />
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
