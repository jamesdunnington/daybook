'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Blocks } from 'lucide-react';
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

function NewProjectDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      fetch('/api/power-tab/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || undefined }),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to create project');
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['power-tab-projects'] });
      toast.success('Project created');
      setOpen(false);
      setName('');
      setDescription('');
    },
    onError: () => toast.error('Failed to create project'),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="h-4 w-4" />
        New Project
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
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
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PowerTabPage() {
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['power-tab-projects'],
    queryFn: fetchProjects,
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
        <NewProjectDialog />
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
          <NewProjectDialog />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/power-tab/${project.id}`} className="block group">
              <Card className="h-full transition-shadow group-hover:ring-ring/30">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base truncate">{project.name}</CardTitle>
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
          ))}
        </div>
      )}
    </div>
  );
}
