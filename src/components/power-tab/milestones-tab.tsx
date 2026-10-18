'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Target, Pencil, Ban, RotateCcw, X } from 'lucide-react';
import { undoableDelete } from '@/lib/power-tab/undo-toast';
import { useConfirm } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  type Milestone,
  dayString,
  formatDay,
  jsonHeaders,
  readError,
  useRefreshPowerTab,
} from './shared';

const MAX_TARGETS = 500;

function MilestoneDialog({
  projectId,
  milestone,
  trigger,
}: {
  projectId: string;
  milestone?: Milestone;
  trigger: React.ReactElement;
}) {
  const refresh = useRefreshPowerTab(projectId);
  const isEdit = !!milestone;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [unitLabel, setUnitLabel] = useState(milestone?.unitLabel ?? 'items');
  const [targetDate, setTargetDate] = useState(milestone?.targetDate ? dayString(milestone.targetDate) : '');
  // Create: one optional name box per target, starting with a single box.
  const [names, setNames] = useState<string[]>(['']);
  const [countText, setCountText] = useState('1');
  // Edit: just the number (names are edited in the Activity Log).
  const [editCount, setEditCount] = useState(milestone ? String(parseFloat(milestone.targetCount)) : '');

  function resizeNames(n: number) {
    setNames((prev) => (n > prev.length ? [...prev, ...Array<string>(n - prev.length).fill('')] : prev.slice(0, n)));
  }

  function changeCount(text: string) {
    setCountText(text);
    const n = Math.floor(Number(text));
    if (Number.isFinite(n) && n >= 1) resizeNames(Math.min(n, MAX_TARGETS));
  }

  function addBox() {
    if (names.length >= MAX_TARGETS) return;
    setNames((prev) => [...prev, '']);
    setCountText(String(names.length + 1));
  }

  function removeBox(index: number) {
    if (names.length <= 1) return;
    setNames((prev) => prev.filter((_, i) => i !== index));
    setCountText(String(names.length - 1));
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch(
        isEdit
          ? `/api/power-tab/projects/${projectId}/milestones/${milestone!.id}`
          : `/api/power-tab/projects/${projectId}/milestones`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(
            isEdit
              ? { title, unitLabel, targetCount: Number(editCount), targetDate }
              : { title, unitLabel, targetCount: names.length, targetDate, items: names }
          ),
        }
      ).then(async (r) => {
        if (!r.ok) {
          throw new Error(await readError(r, isEdit ? 'Failed to update milestone' : 'Failed to create milestone'));
        }
        return r.json();
      }),
    onSuccess: () => {
      refresh();
      toast.success(isEdit ? 'Milestone updated' : 'Milestone created');
      setOpen(false);
      if (!isEdit) {
        setTitle('');
        setTargetDate('');
        setNames(['']);
        setCountText('1');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const countOk = isEdit ? Number(editCount) >= 1 : names.length >= 1;
  const canSave = !!title.trim() && !!targetDate && countOk && !saveMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && isEdit) {
          setTitle(milestone!.title);
          setUnitLabel(milestone!.unitLabel);
          setEditCount(String(parseFloat(milestone!.targetCount)));
          setTargetDate(milestone!.targetDate ? dayString(milestone!.targetDate) : '');
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
              min={1}
              max={MAX_TARGETS}
              placeholder="Target count"
              aria-label="Target count"
              value={isEdit ? editCount : countText}
              onChange={(e) => (isEdit ? setEditCount(e.target.value) : changeCount(e.target.value))}
              onBlur={() => !isEdit && setCountText(String(names.length))}
            />
            <Input placeholder="Unit (e.g. articles)" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="milestone-date">
              Completion date (required)
            </label>
            <Input id="milestone-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>

          {isEdit ? (
            <p className="text-xs text-muted-foreground">
              Raising the count adds empty targets to the Activity Log; lowering it removes empty ones only.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Targets — naming them is optional, you can also do it later
              </p>
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {names.map((name, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input
                      placeholder={`Target ${i + 1} (optional)`}
                      value={name}
                      onChange={(e) => setNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))}
                      className="h-8"
                    />
                    {names.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground"
                        onClick={() => removeBox(i)}
                        aria-label={`Remove target ${i + 1}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addBox}>
                <Plus className="h-4 w-4" />
                Add target
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => saveMutation.mutate()} disabled={!canSave}>
            {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MilestonesTab({ projectId }: { projectId: string }) {
  const refresh = useRefreshPowerTab(projectId);
  const confirm = useConfirm();

  // The API lists abandoned milestones last.
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
      refresh();
      undoableDelete('Milestone deleted', data.undoId, data.undoExpiresAt);
    },
    onError: () => toast.error('Failed to delete milestone'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ milestoneId, status }: { milestoneId: string; status: 'active' | 'abandoned' }) =>
      fetch(`/api/power-tab/projects/${projectId}/milestones/${milestoneId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r, 'Failed to update milestone'));
        return r.json();
      }),
    onSuccess: (_data, { status }) => {
      refresh();
      toast.success(status === 'abandoned' ? 'Milestone abandoned' : 'Milestone restored');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleAbandon(m: Milestone) {
    const ok = await confirm({
      title: `Abandon "${m.title}"?`,
      description:
        'The milestone and its targets are greyed out and moved to the end of the list. They stop counting toward the project, and you can restore them any time.',
      confirmLabel: 'Abandon',
    });
    if (ok) statusMutation.mutate({ milestoneId: m.id, status: 'abandoned' });
  }

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
        <p className="py-8 text-center text-sm text-muted-foreground">No milestones yet.</p>
      ) : (
        <ul className="space-y-3">
          {milestones.map((m) => {
            const abandoned = m.status === 'abandoned';
            const { itemCounts } = m;
            return (
              <li
                key={m.id}
                className={`space-y-2 rounded-lg border p-3 ${abandoned ? 'opacity-60 grayscale' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Target className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate text-sm font-medium">{m.title}</span>
                    {abandoned && <Badge variant="outline">Abandoned</Badge>}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    {abandoned ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => statusMutation.mutate({ milestoneId: m.id, status: 'active' })}
                        aria-label={`Restore milestone ${m.title}`}
                        title="Restore"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <>
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
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={() => handleAbandon(m)}
                          aria-label={`Abandon milestone ${m.title}`}
                          title="Abandon"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
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
                    {!abandoned && ` · ${itemCounts.open} left`}
                    {!abandoned && itemCounts.overdue > 0 && (
                      <span className="text-destructive"> · {itemCounts.overdue} overdue</span>
                    )}
                  </span>
                  <Badge variant="outline">{m.forecast.percentComplete.toFixed(0)}%</Badge>
                </div>

                <p className="text-xs text-muted-foreground">
                  {m.targetDate ? `Due ${formatDay(m.targetDate)}. ` : null}
                  {!m.targetDate && !abandoned && (
                    <span className="text-destructive">No completion date yet — edit the milestone to set one. </span>
                  )}
                  {!abandoned &&
                    (m.forecast.forecastDate
                      ? `${m.forecast.note} Forecast finish: ${formatDay(m.forecast.forecastDate)}.`
                      : m.forecast.note)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
