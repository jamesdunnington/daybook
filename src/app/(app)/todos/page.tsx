'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Calendar, Tag } from 'lucide-react';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TodoCategory {
  id: string;
  name: string;
  color: string;
  icon: string | null;
}

interface Todo {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueDate: string | null;
  completedAt: string | null;
  categoryId: string | null;
  position: number;
  createdAt: string;
}

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  urgent: { label: 'Urgent', className: 'bg-red-100 text-red-700 border-red-200' },
  high: { label: 'High', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  medium: { label: 'Medium', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  low: { label: 'Low', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchTodos(categoryId?: string): Promise<Todo[]> {
  const url = categoryId
    ? `/api/todos?categoryId=${encodeURIComponent(categoryId)}`
    : '/api/todos';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch todos');
  return res.json();
}

async function fetchCategories(): Promise<TodoCategory[]> {
  const res = await fetch('/api/todos/categories');
  if (!res.ok) throw new Error('Failed to fetch categories');
  return res.json();
}

// ─── Manage Categories Dialog ─────────────────────────────────────────────────

function ManageCategoriesDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');

  const { data: categories = [] } = useQuery<TodoCategory[]>({
    queryKey: ['todo-categories'],
    queryFn: fetchCategories,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/todos/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      if (!res.ok) throw new Error('Failed to create category');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todo-categories'] });
      setName('');
      setColor('#6366f1');
      toast.success('Category added');
    },
    onError: () => toast.error('Failed to add category'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/todos/categories/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete category');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todo-categories'] });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      toast.success('Category deleted');
    },
    onError: () => toast.error('Failed to delete category'),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Tag className="mr-2 h-4 w-4" />
        Categories
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Categories</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <form
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) addMutation.mutate(); }}
            className="flex gap-2"
          >
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-9 rounded border cursor-pointer shrink-0"
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Category name"
              className="flex-1"
            />
            <Button type="submit" disabled={!name.trim() || addMutation.isPending}>
              Add
            </Button>
          </form>

          <div className="space-y-1 max-h-60 overflow-y-auto">
            {categories.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No categories yet</p>
            )}
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent">
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="flex-1 text-sm">{cat.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={() => deleteMutation.mutate(cat.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Todo Dialog ──────────────────────────────────────────────────────────

function AddTodoDialog({ categories }: { categories: TodoCategory[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [categoryId, setCategoryId] = useState('none');
  const [dueDate, setDueDate] = useState('');

  const mutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description?: string;
      priority: string;
      categoryId?: string;
      dueDate?: string;
    }) => {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to create todo');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      setOpen(false);
      setTitle('');
      setDescription('');
      setPriority('medium');
      setCategoryId('none');
      setDueDate('');
      toast.success('Todo created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    mutation.mutate({
      title: title.trim(),
      description: description || undefined,
      priority,
      categoryId: categoryId !== 'none' ? categoryId : undefined,
      dueDate: dueDate || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 h-4 w-4" />
        Add Todo
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Todo</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="todo-title">Title *</Label>
            <Input
              id="todo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v ?? 'medium')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id} label={cat.name}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="todo-due">Due Date</Label>
            <Input
              id="todo-due"
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="todo-desc">Description</Label>
            <Textarea
              id="todo-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes…"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Todo Item ────────────────────────────────────────────────────────────────

function TodoItem({
  todo,
  categories,
}: {
  todo: Todo;
  categories: TodoCategory[];
}) {
  const queryClient = useQueryClient();
  const isCompleted = todo.status === 'completed';
  const category = categories.find((c) => c.id === todo.categoryId);
  const priorityConfig = PRIORITY_CONFIG[todo.priority] ?? PRIORITY_CONFIG.medium;

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const newStatus = isCompleted ? 'pending' : 'completed';
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to update todo');
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/todos/${todo.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to delete todo');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      toast.success('Todo deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="flex items-start gap-3 py-3 px-4 rounded-lg border bg-card hover:bg-accent/30 transition-colors group">
      <Checkbox
        checked={isCompleted}
        onCheckedChange={() => toggleMutation.mutate()}
        disabled={toggleMutation.isPending}
        className="mt-0.5 shrink-0"
      />

      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium leading-snug ${
            isCompleted ? 'line-through text-muted-foreground' : ''
          }`}
        >
          {todo.title}
        </p>
        {todo.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {todo.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <Badge
            variant="outline"
            className={`text-xs px-1.5 py-0 ${priorityConfig.className}`}
          >
            {priorityConfig.label}
          </Badge>
          {category && (
            <Badge
              variant="outline"
              className="text-xs px-1.5 py-0"
              style={{ borderColor: category.color, color: category.color }}
            >
              {category.name}
            </Badge>
          )}
          {todo.dueDate && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {format(new Date(todo.dueDate), 'MMM d, yyyy')}
            </span>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive transition-colors"
        onClick={() => deleteMutation.mutate()}
        disabled={deleteMutation.isPending}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Todo List ────────────────────────────────────────────────────────────────

function TodoList({
  categoryId,
  categories,
}: {
  categoryId?: string;
  categories: TodoCategory[];
}) {
  const { data: todos = [], isLoading, isError } = useQuery({
    queryKey: ['todos', categoryId ?? 'all'],
    queryFn: () => fetchTodos(categoryId),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-14 rounded-lg border bg-muted animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-center text-sm text-destructive py-8">
        Failed to load todos.
      </p>
    );
  }

  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Plus className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">No todos yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Add your first todo to get started
        </p>
      </div>
    );
  }

  const pending = todos.filter((t) => t.status !== 'completed');
  const completed = todos.filter((t) => t.status === 'completed');

  return (
    <div className="space-y-1">
      {pending.map((todo) => (
        <TodoItem key={todo.id} todo={todo} categories={categories} />
      ))}
      {completed.length > 0 && (
        <>
          <p className="text-xs font-medium text-muted-foreground pt-4 pb-1 px-1">
            Completed ({completed.length})
          </p>
          {completed.map((todo) => (
            <TodoItem key={todo.id} todo={todo} categories={categories} />
          ))}
        </>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TodosPage() {
  const { data: categories = [] } = useQuery({
    queryKey: ['todo-categories'],
    queryFn: fetchCategories,
  });

  // Build tabs: "all" + first 4 categories
  const tabs = [
    { id: 'all', label: 'All', categoryId: undefined },
    ...categories.slice(0, 4).map((cat) => ({
      id: cat.id,
      label: cat.name,
      categoryId: cat.id,
    })),
  ];

  return (
    <div className="container max-w-2xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Todos</h1>
          <p className="text-sm text-muted-foreground">
            Manage your tasks and to-dos
          </p>
        </div>
        <div className="flex gap-2">
          <ManageCategoriesDialog />
          <AddTodoDialog categories={categories} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Tabs defaultValue="all">
            <div className="border-b px-4 pt-4">
              <TabsList className="mb-0">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {tabs.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="p-4 mt-0">
                <TodoList
                  categoryId={tab.categoryId}
                  categories={categories}
                />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
