'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, FileText, CheckCircle2, RotateCcw } from 'lucide-react';
import { undoableDelete } from '@/lib/power-tab/undo-toast';
import { useConfirm } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BlockEditor } from '@/components/power-tab/block-editor';
import { ActivityTab } from '@/components/power-tab/activity-tab';
import { MilestonesTab } from '@/components/power-tab/milestones-tab';
import { type Milestone, formatDay, jsonHeaders } from '@/components/power-tab/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
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

/** Overall and per-milestone progress, shown above the tabs so it's visible from any of them. */
function ProgressStrip({ milestones }: { milestones: Milestone[] }) {
  const active = milestones.filter((m) => m.status === 'active');

  if (active.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        No milestones yet. Add one in the Milestones tab, then tick off its targets in the Activity Log to track progress here.
      </p>
    );
  }

  const overall = Math.round(
    active.reduce((sum, m) => sum + m.forecast.percentComplete, 0) / active.length
  );

  return (
    <div className="space-y-3 rounded-lg border px-3 py-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Overall progress</span>
        <span className="font-semibold">{overall}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${overall}%` }} />
      </div>
      <ul className="space-y-3">
        {active.map((m) => {
          const { forecast } = m;
          const pct = Math.round(forecast.percentComplete);
          const done = forecast.remaining <= 0;
          const behind =
            !done &&
            !!m.targetDate &&
            !!forecast.forecastDate &&
            new Date(forecast.forecastDate) > new Date(m.targetDate);
          return (
            <li key={m.id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">{m.title}</span>
                <span className="shrink-0 text-muted-foreground">{pct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${behind ? 'bg-destructive' : 'bg-primary'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {forecast.progressSoFar} of {forecast.targetCount} {m.unitLabel}
                {m.targetDate && ` · due ${formatDay(m.targetDate, 'MMM d')}`}
                {done && ' · done'}
                {behind && <span className="text-destructive"> · behind pace</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const { data: project } = useQuery<Project>({
    queryKey: ['power-tab-project', projectId],
    queryFn: () => fetch(`/api/power-tab/projects/${projectId}`).then((r) => r.json()),
  });

  const queryClient = useQueryClient();
  const isCompleted = project?.status === 'completed';

  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ['power-tab-milestones', projectId],
    queryFn: () => fetch(`/api/power-tab/projects/${projectId}/milestones`).then((r) => r.json()),
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'active' | 'completed') =>
      fetch(`/api/power-tab/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to update project status');
        return r.json();
      }),
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ['power-tab-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['power-tab-projects'] });
      toast.success(status === 'completed' ? 'Project marked complete' : 'Project reopened');
    },
    onError: () => toast.error('Failed to update project status'),
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight truncate">{project?.name ?? 'Loading…'}</h1>
            {isCompleted && <Badge variant="outline">Completed</Badge>}
          </div>
          {project?.description && <p className="text-sm text-muted-foreground mt-1">{project.description}</p>}
        </div>
        {project && (
          <Button
            variant="outline"
            className="shrink-0"
            disabled={statusMutation.isPending}
            onClick={() => statusMutation.mutate(isCompleted ? 'active' : 'completed')}
          >
            {isCompleted ? (
              <>
                <RotateCcw className="h-4 w-4" />
                Reopen
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Mark complete
              </>
            )}
          </Button>
        )}
      </div>

      <ProgressStrip milestones={milestones} />

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
