'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  addMonths,
  subMonths,
  isSameDay,
  parseISO,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, X, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface JournalEntry {
  id: string;
  userId: string;
  entryDate: string;
  title: string | null;
  content: string;
  mood: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface JournalPhoto {
  id: string;
  entryId: string;
  userId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  caption: string | null;
  sortOrder: number;
  createdAt: string;
}

interface JournalEntryWithPhotos extends JournalEntry {
  photos: JournalPhoto[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MOODS = [
  { value: 'great', emoji: '😄', label: 'Great' },
  { value: 'good', emoji: '😊', label: 'Good' },
  { value: 'neutral', emoji: '😐', label: 'Neutral' },
  { value: 'bad', emoji: '😕', label: 'Bad' },
  { value: 'terrible', emoji: '😢', label: 'Terrible' },
] as const;

function getMoodEmoji(mood: string | null): string {
  if (!mood) return '';
  return MOODS.find((m) => m.value === mood)?.emoji ?? '';
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchEntries(month: string): Promise<JournalEntry[]> {
  const res = await fetch(`/api/journal?month=${month}`);
  if (!res.ok) throw new Error('Failed to load entries');
  return res.json();
}

async function fetchEntry(id: string): Promise<JournalEntryWithPhotos> {
  const res = await fetch(`/api/journal/${id}`);
  if (!res.ok) throw new Error('Failed to load entry');
  return res.json();
}

async function createEntry(body: {
  title?: string;
  content: string;
  mood?: string;
  tags?: string[];
  entryDate?: string;
}): Promise<JournalEntry> {
  const res = await fetch('/api/journal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create entry');
  }
  return res.json();
}

async function updateEntry(
  id: string,
  body: { title?: string | null; content?: string; mood?: string | null; tags?: string[] }
): Promise<JournalEntry> {
  const res = await fetch(`/api/journal/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to update entry');
  }
  return res.json();
}

async function deleteEntry(id: string): Promise<void> {
  const res = await fetch(`/api/journal/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to delete entry');
  }
}

async function uploadPhotos(entryId: string, files: File[]): Promise<JournalPhoto[]> {
  const formData = new FormData();
  for (const file of files) formData.append('photos', file);

  const res = await fetch(`/api/journal/${entryId}/photos`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to upload photos');
  }
  return res.json();
}

async function deletePhoto(entryId: string, photoId: string): Promise<void> {
  const res = await fetch(`/api/journal/${entryId}/photos?photoId=${photoId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to delete photo');
  }
}

// ─── Month Calendar Grid ──────────────────────────────────────────────────────

function MonthCalendar({
  currentMonth,
  entries,
  selectedDate,
  onSelectDate,
}: {
  currentMonth: Date;
  entries: JournalEntry[];
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
}) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Day of week offset (0=Sun)
  const startOffset = getDay(monthStart);

  // Build a set of entry date strings 'yyyy-MM-dd'
  const entryDateSet = new Set(
    entries.map((e) => format(parseISO(e.entryDate), 'yyyy-MM-dd'))
  );

  const today = new Date();

  return (
    <div className="select-none">
      <div className="grid grid-cols-7 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {/* Empty cells for offset */}
        {Array.from({ length: startOffset }).map((_, i) => (
          <div key={`offset-${i}`} />
        ))}
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const hasEntry = entryDateSet.has(dateStr);
          const isToday = isSameDay(day, today);
          const isSelected = selectedDate && isSameDay(day, selectedDate);

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onSelectDate(day)}
              className={`relative flex flex-col items-center justify-center rounded-lg p-1 text-sm transition-colors h-9 w-full
                ${isSelected ? 'bg-primary text-primary-foreground' : ''}
                ${isToday && !isSelected ? 'font-bold text-primary' : ''}
                ${!isSelected ? 'hover:bg-muted' : ''}
              `}
            >
              <span>{format(day, 'd')}</span>
              {hasEntry && (
                <span
                  className={`absolute bottom-1 h-1 w-1 rounded-full ${
                    isSelected ? 'bg-primary-foreground' : 'bg-primary'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── New Entry Dialog ─────────────────────────────────────────────────────────

interface NewEntryDialogProps {
  open: boolean;
  onClose: () => void;
  defaultDate?: string;
  onCreated: () => void;
}

function NewEntryDialog({ open, onClose, defaultDate, onCreated }: NewEntryDialogProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState<string>('');
  const [tagsInput, setTagsInput] = useState('');
  const [entryDate, setEntryDate] = useState(
    defaultDate ?? format(new Date(), 'yyyy-MM-dd')
  );
  const [photos, setPhotos] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () => {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const entry = await createEntry({
        title: title.trim() || undefined,
        content,
        mood: mood || undefined,
        tags,
        entryDate,
      });

      if (photos.length > 0) {
        await uploadPhotos(entry.id, photos).catch((err) => {
          toast.error(`Entry created but photos failed: ${err.message}`);
        });
      }

      return entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      onCreated();
      toast.success('Entry created');
      handleReset();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function handleReset() {
    setTitle('');
    setContent('');
    setMood('');
    setTagsInput('');
    setEntryDate(format(new Date(), 'yyyy-MM-dd'));
    setPhotos([]);
  }

  function handleClose() {
    handleReset();
    onClose();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPhotos((prev) => [...prev, ...files]);
    e.target.value = '';
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Journal Entry</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Date */}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="entry-date">
              Date
            </label>
            <Input
              id="entry-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>

          {/* Mood */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Mood</label>
            <div className="flex gap-2">
              {MOODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  title={m.label}
                  onClick={() => setMood(mood === m.value ? '' : m.value)}
                  className={`text-xl rounded-lg p-1.5 transition-colors hover:bg-muted ${
                    mood === m.value ? 'bg-muted ring-2 ring-ring' : ''
                  }`}
                >
                  {m.emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="entry-title">
              Title <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="entry-title"
              placeholder="Give your entry a title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Content */}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="entry-content">
              Content
            </label>
            <Textarea
              id="entry-content"
              placeholder="What's on your mind?"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-32 resize-y"
            />
          </div>

          {/* Tags */}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="entry-tags">
              Tags <span className="text-muted-foreground">(comma-separated)</span>
            </label>
            <Input
              id="entry-tags"
              placeholder="work, personal, ideas..."
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>

          {/* Photos */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Photos</label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageIcon className="h-4 w-4" />
                Add photos
              </Button>
              <span className="text-xs text-muted-foreground">
                {photos.length > 0 ? `${photos.length} file(s) selected` : 'Max 10 MB each'}
              </span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            {photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {photos.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
                  >
                    <span className="max-w-[120px] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !content.trim()}
          >
            {createMutation.isPending ? 'Saving...' : 'Save Entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Entry Detail Sheet ───────────────────────────────────────────────────────

function EntryDetailSheet({
  entryId,
  open,
  onClose,
}: {
  entryId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editMood, setEditMood] = useState('');
  const [editTags, setEditTags] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: entry, isLoading } = useQuery({
    queryKey: ['journal-entry', entryId],
    queryFn: () => fetchEntry(entryId!),
    enabled: !!entryId && open,
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateEntry(entryId!, {
        title: editTitle.trim() || null,
        content: editContent,
        mood: editMood || null,
        tags: editTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entry', entryId] });
      setEditing(false);
      toast.success('Entry updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteEntry(entryId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      onClose();
      toast.success('Entry deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => uploadPhotos(entryId!, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entry', entryId] });
      toast.success('Photos uploaded');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deletePhotoMutation = useMutation({
    mutationFn: (photoId: string) => deletePhoto(entryId!, photoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entry', entryId] });
      toast.success('Photo deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function startEditing() {
    if (!entry) return;
    setEditTitle(entry.title ?? '');
    setEditContent(entry.content);
    setEditMood(entry.mood ?? '');
    setEditTags((entry.tags ?? []).join(', '));
    setEditing(true);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) uploadMutation.mutate(files);
    e.target.value = '';
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { setEditing(false); onClose(); } }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto flex flex-col gap-0 p-0">
        {isLoading || !entry ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            Loading...
          </div>
        ) : (
          <>
            <SheetHeader className="border-b p-4 pr-12">
              <div className="flex items-start gap-2">
                {entry.mood && (
                  <span className="text-2xl leading-none mt-0.5">
                    {getMoodEmoji(entry.mood)}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <SheetTitle className="truncate">
                    {entry.title || format(parseISO(entry.entryDate), 'MMMM d, yyyy')}
                  </SheetTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(parseISO(entry.entryDate), 'EEEE, MMMM d, yyyy')}
                  </p>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {!editing ? (
                <>
                  {/* Content */}
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {entry.content || (
                      <span className="text-muted-foreground italic">No content.</span>
                    )}
                  </div>

                  {/* Tags */}
                  {entry.tags && entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {entry.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Photos */}
                  {entry.photos.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Photos
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {entry.photos.map((photo) => (
                          <div key={photo.id} className="relative group rounded-lg overflow-hidden aspect-square bg-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/uploads/journal/${photo.userId}/${photo.filename}`}
                              alt={photo.originalName}
                              className="object-cover w-full h-full"
                            />
                            <button
                              type="button"
                              onClick={() => deletePhotoMutation.mutate(photo.id)}
                              className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Edit form */
                <div className="space-y-4">
                  {/* Mood */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Mood</label>
                    <div className="flex gap-2">
                      {MOODS.map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          title={m.label}
                          onClick={() => setEditMood(editMood === m.value ? '' : m.value)}
                          className={`text-xl rounded-lg p-1.5 transition-colors hover:bg-muted ${
                            editMood === m.value ? 'bg-muted ring-2 ring-ring' : ''
                          }`}
                        >
                          {m.emoji}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="edit-title">Title</label>
                    <Input
                      id="edit-title"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Entry title..."
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="edit-content">Content</label>
                    <Textarea
                      id="edit-content"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="min-h-40 resize-y"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="edit-tags">
                      Tags <span className="text-muted-foreground">(comma-separated)</span>
                    </label>
                    <Input
                      id="edit-tags"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      placeholder="work, personal..."
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Action bar */}
            <div className="border-t p-3 flex items-center gap-2 flex-wrap">
              {!editing ? (
                <>
                  <Button variant="outline" size="sm" onClick={startEditing}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMutation.isPending}
                  >
                    <ImageIcon className="h-4 w-4" />
                    {uploadMutation.isPending ? 'Uploading...' : 'Add photos'}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    className="ml-auto"
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(false)}
                    disabled={updateMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => updateMutation.mutate()}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? 'Saving...' : 'Save'}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Journal Page ────────────────────────────────────────────────────────

export default function JournalPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const monthKey = format(currentMonth, 'yyyy-MM');

  const { data: entries = [], isLoading } = useQuery<JournalEntry[]>({
    queryKey: ['journal', monthKey],
    queryFn: () => fetchEntries(monthKey),
  });

  const queryClient = useQueryClient();

  // Entries filtered by selected date or all entries for the month
  const displayedEntries = selectedDate
    ? entries.filter((e) => isSameDay(parseISO(e.entryDate), selectedDate))
    : entries;

  function handleMonthPrev() {
    setCurrentMonth((m) => subMonths(m, 1));
    setSelectedDate(null);
  }

  function handleMonthNext() {
    setCurrentMonth((m) => addMonths(m, 1));
    setSelectedDate(null);
  }

  function handleSelectDate(date: Date) {
    setSelectedDate((prev) => (prev && isSameDay(prev, date) ? null : date));
  }

  const defaultDate = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined;

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      {/* Left panel: calendar + controls */}
      <div className="md:w-72 shrink-0 border-b md:border-b-0 md:border-r p-4 space-y-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">{format(currentMonth, 'MMMM yyyy')}</h2>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" onClick={handleMonthPrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={handleMonthNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Calendar grid */}
        <MonthCalendar
          currentMonth={currentMonth}
          entries={entries}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
        />

        {/* New entry button */}
        <Button
          className="w-full"
          onClick={() => setNewEntryOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New Entry
        </Button>

        {/* Entry count */}
        <p className="text-xs text-muted-foreground text-center">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} this month
        </p>
      </div>

      {/* Right panel: entries list */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedDate && (
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {format(selectedDate, 'EEEE, MMMM d')}
            </h3>
            <button
              type="button"
              onClick={() => setSelectedDate(null)}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Show all
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Loading entries...
          </div>
        ) : displayedEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <BookOpenIcon className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">
              {selectedDate
                ? 'No entry for this day. Start writing!'
                : 'No entries this month yet.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewEntryOpen(true)}
            >
              <Plus className="h-4 w-4" />
              New Entry
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {displayedEntries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setSelectedEntryId(entry.id)}
                  className="w-full text-left rounded-xl border bg-card px-4 py-3 hover:ring-1 hover:ring-ring transition-all space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(entry.entryDate), 'MMM d')}
                    </span>
                    {entry.mood && (
                      <span className="text-base leading-none">
                        {getMoodEmoji(entry.mood)}
                      </span>
                    )}
                    {entry.title && (
                      <span className="text-sm font-medium truncate flex-1">
                        {entry.title}
                      </span>
                    )}
                  </div>
                  {!entry.title && entry.content && (
                    <p className="text-sm text-muted-foreground truncate">
                      {entry.content.slice(0, 50)}
                      {entry.content.length > 50 ? '...' : ''}
                    </p>
                  )}
                  {entry.tags && entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {entry.tags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs h-4">
                          {tag}
                        </Badge>
                      ))}
                      {entry.tags.length > 4 && (
                        <span className="text-xs text-muted-foreground">
                          +{entry.tags.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Dialogs */}
      <NewEntryDialog
        open={newEntryOpen}
        onClose={() => setNewEntryOpen(false)}
        defaultDate={defaultDate}
        onCreated={() => setNewEntryOpen(false)}
      />

      <EntryDetailSheet
        entryId={selectedEntryId}
        open={!!selectedEntryId}
        onClose={() => setSelectedEntryId(null)}
      />
    </div>
  );
}

// Inline icon to avoid import issues with no-img-element in the empty state
function BookOpenIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
      />
    </svg>
  );
}
