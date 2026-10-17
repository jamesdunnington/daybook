'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Blocks, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { undoableDelete } from '@/lib/power-tab/undo-toast';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  color: string | null;
  updatedAt: string;
}

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch('/api/power-tab/projects');
  if (!res.ok) throw new Error('Failed to load projects');
  return res.json();
}

// ─── Create / edit dialog ───────────────────────────────────────────────────

function ProjectDialog({
  project,
  trigger,
}: {
  project?: Project;
  trigger: React.ReactElement;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!project;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch(isEdit ? `/api/power-tab/projects/${project!.id}` : '/api/power-tab/projects', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || null }),
      }).then((r) => {
        if (!r.ok) throw new Error(isEdit ? 'Failed to update project' : 'Failed to create project');
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['power-tab-projects'] });
      toast.success(isEdit ? 'Project updated' : 'Project created');
      setOpen(false);
      if (!isEdit) {
        setName('');
        setDescription('');
      }
    },
    onError: () => toast.error(isEdit ? 'Failed to update project' : 'Failed to create project'),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && isEdit) {
          setName(project!.name);
          setDescription(project!.description ?? '');
        }
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit project' : 'New project'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button onClick={() => saveMutation.mutate()} disabled={!name.trim() || saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PowerTabPage() {
  const queryClient = useQueryClient();
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['power-tab-projects'],
    queryFn: fetchProjects,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/power-tab/projects/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error('Failed to delete project');
        return r.json();
      }),
    onSuccess: (data: { undoId?: string; undoExpiresAt?: string }, id) => {
      queryClient.invalidateQueries({ queryKey: ['power-tab-projects'] });
      const project = projects.find((p) => p.id === id);
      undoableDelete(`Deleted project "${project?.name ?? ''}"`, data.undoId, data.undoExpiresAt);
    },
    onError: () => toast.error('Failed to delete project'),
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Power Tab</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Projects: activity logs, milestones, and Notion-style docs.
          </p>
        </div>
        <ProjectDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          }
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Blocks className="h-10 w-10 text-muted-foreground/40" />
          <h2 className="text-lg font-semibold">Start your first project</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Track work, milestones, and notes for a site or project.
          </p>
          <ProjectDialog
            trigger={
              <Button>
                <Plus className="h-4 w-4" />
                New Project
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div key={project.id} className="group relative">
              <Link href={`/power-tab/${project.id}`} className="block">
                <Card className="h-full transition-shadow group-hover:ring-ring/30">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base truncate pr-12">{project.name}</CardTitle>
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: project.color ?? '#0D9488' }}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {project.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                    )}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <Badge variant="outline" className="capitalize">{project.status}</Badge>
                      <span>Updated {format(new Date(project.updatedAt), 'MMM d')}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>

              <div className="absolute right-3 top-3 flex gap-0.5 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-within:opacity-100">
                <ProjectDialog
                  project={project}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label={`Edit project ${project.name}`}
                      onClick={(e: React.MouseEvent) => e.preventDefault()}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  aria-label={`Delete project ${project.name}`}
                  onClick={(e) => {
                    e.preventDefault();
                    deleteMutation.mutate(project.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
