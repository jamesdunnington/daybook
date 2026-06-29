'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Trash2, Clock, MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  color: string;
  rrule: string | null;
  instanceDate: string;
}

// ─── Color presets ────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  { value: '#6366f1', label: 'Indigo' },
  { value: '#10b981', label: 'Emerald' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Violet' },
];

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchEvents(start: Date, end: Date): Promise<CalendarEvent[]> {
  const url = `/api/calendar?start=${start.toISOString()}&end=${end.toISOString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch events');
  return res.json();
}

// ─── Add Event Dialog ─────────────────────────────────────────────────────────

function AddEventDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: Date | null;
}) {
  const queryClient = useQueryClient();

  const defaultStart = defaultDate
    ? format(defaultDate, "yyyy-MM-dd'T'HH:mm")
    : format(new Date(), "yyyy-MM-dd'T'HH:mm");
  const defaultEnd = defaultDate
    ? format(new Date(defaultDate.getTime() + 60 * 60 * 1000), "yyyy-MM-dd'T'HH:mm")
    : format(new Date(Date.now() + 60 * 60 * 1000), "yyyy-MM-dd'T'HH:mm");

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState(defaultStart);
  const [endAt, setEndAt] = useState(defaultEnd);
  const [allDay, setAllDay] = useState(false);
  const [color, setColor] = useState('#6366f1');

  // Reset when default date changes
  const resetForm = () => {
    setTitle('');
    setDescription('');
    setStartAt(
      defaultDate
        ? format(defaultDate, "yyyy-MM-dd'T'HH:mm")
        : format(new Date(), "yyyy-MM-dd'T'HH:mm")
    );
    setEndAt(
      defaultDate
        ? format(new Date(defaultDate.getTime() + 60 * 60 * 1000), "yyyy-MM-dd'T'HH:mm")
        : format(new Date(Date.now() + 60 * 60 * 1000), "yyyy-MM-dd'T'HH:mm")
    );
    setAllDay(false);
    setColor('#6366f1');
  };

  const mutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description?: string;
      startAt: string;
      endAt: string;
      allDay: boolean;
      color: string;
    }) => {
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to create event');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      onOpenChange(false);
      resetForm();
      toast.success('Event created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const startDate = allDay
      ? new Date(startAt + ':00')
      : new Date(startAt);
    const endDate = allDay
      ? new Date(endAt + ':00')
      : new Date(endAt);

    mutation.mutate({
      title: title.trim(),
      description: description || undefined,
      startAt: startDate.toISOString(),
      endAt: endDate.toISOString(),
      allDay,
      color,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetForm();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Event</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="event-title">Title *</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="all-day"
              checked={allDay}
              onCheckedChange={(v) => setAllDay(Boolean(v))}
            />
            <Label htmlFor="all-day" className="cursor-pointer font-normal">
              All day
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="event-start">Start</Label>
              <Input
                id="event-start"
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? startAt.slice(0, 10) : startAt}
                onChange={(e) =>
                  setStartAt(allDay ? e.target.value + 'T00:00' : e.target.value)
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-end">End</Label>
              <Input
                id="event-end"
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? endAt.slice(0, 10) : endAt}
                onChange={(e) =>
                  setEndAt(allDay ? e.target.value + 'T23:59' : e.target.value)
                }
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c.value,
                    borderColor: color === c.value ? 'white' : 'transparent',
                    outline: color === c.value ? `2px solid ${c.value}` : 'none',
                  }}
                  onClick={() => setColor(c.value)}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-desc">Description</Label>
            <Textarea
              id="event-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create Event'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Event Detail Dialog ──────────────────────────────────────────────────────

function EventDetailDialog({
  event,
  onClose,
}: {
  event: CalendarEvent | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/calendar/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to delete event');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      onClose();
      toast.success('Event deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!event) return null;

  const start = new Date(event.startAt);
  const end = new Date(event.endAt);

  return (
    <Dialog open={!!event} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div
              className="h-3 w-3 rounded-full mt-1.5 shrink-0"
              style={{ backgroundColor: event.color }}
            />
            <DialogTitle className="leading-snug">{event.title}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            <span>
              {event.allDay ? (
                format(start, 'MMMM d, yyyy')
              ) : (
                <>
                  {format(start, 'MMM d, yyyy h:mm a')}
                  {' – '}
                  {isSameDay(start, end)
                    ? format(end, 'h:mm a')
                    : format(end, 'MMM d, yyyy h:mm a')}
                </>
              )}
            </span>
          </div>

          {event.location && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" />
              <span>{event.location}</span>
            </div>
          )}

          {event.description && (
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {event.description}
            </p>
          )}

          {event.rrule && (
            <Badge variant="secondary" className="text-xs">
              Recurring
            </Badge>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => deleteMutation.mutate(event.id)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Calendar Grid ─────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function CalendarGrid({
  currentMonth,
  events,
  onDayClick,
  onEventClick,
}: {
  currentMonth: Date;
  events: CalendarEvent[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  // Map events to dates
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const event of events) {
      const key = format(new Date(event.instanceDate), 'yyyy-MM-dd');
      if (!map[key]) map[key] = [];
      map[key].push(event);
    }
    return map;
  }, [events]);

  return (
    <div className="border rounded-xl overflow-hidden bg-card">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b bg-muted/50">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsByDate[key] ?? [];
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const todayDay = isToday(day);

          return (
            <div
              key={key}
              className={`min-h-[80px] md:min-h-[100px] border-r border-b last:border-r-0 p-1 cursor-pointer hover:bg-accent/30 transition-colors ${
                !isCurrentMonth ? 'bg-muted/20' : ''
              } ${idx % 7 === 6 ? 'border-r-0' : ''}`}
              onClick={() => onDayClick(day)}
            >
              <div className="flex justify-between items-start mb-1">
                <span
                  className={`text-xs font-medium h-6 w-6 flex items-center justify-center rounded-full ${
                    todayDay
                      ? 'bg-primary text-primary-foreground'
                      : isCurrentMonth
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                  }`}
                >
                  {format(day, 'd')}
                </span>
                {dayEvents.length > 0 && (
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDayClick(day);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>

              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((event) => (
                  <button
                    key={`${event.id}-${event.instanceDate}`}
                    className="w-full text-left text-[10px] md:text-xs px-1.5 py-0.5 rounded truncate font-medium text-white leading-tight"
                    style={{ backgroundColor: event.color }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(event);
                    }}
                    title={event.title}
                  >
                    {event.allDay ? '' : format(new Date(event.startAt), 'h:mm ')}
                    {event.title}
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <p className="text-[10px] text-muted-foreground px-1">
                    +{dayEvents.length - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [addOpen, setAddOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const rangeStart = startOfWeek(startOfMonth(currentMonth));
  const rangeEnd = endOfWeek(endOfMonth(currentMonth));

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendar-events', format(currentMonth, 'yyyy-MM')],
    queryFn: () => fetchEvents(rangeStart, rangeEnd),
  });

  function handleDayClick(day: Date) {
    setSelectedDay(day);
    setAddOpen(true);
  }

  function handleEventClick(event: CalendarEvent) {
    setSelectedEvent(event);
  }

  function handlePrevMonth() {
    setCurrentMonth((m) => subMonths(m, 1));
    queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
  }

  function handleNextMonth() {
    setCurrentMonth((m) => addMonths(m, 1));
    queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
  }

  return (
    <div className="container max-w-5xl mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            {format(currentMonth, 'MMMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={handlePrevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => setCurrentMonth(new Date())}
            className="text-sm"
          >
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={handleNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => {
              setSelectedDay(new Date());
              setAddOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Event
          </Button>
        </div>
      </div>

      {/* Month name for mobile */}
      <h2 className="text-lg font-semibold mb-3 md:hidden text-center">
        {format(currentMonth, 'MMMM yyyy')}
      </h2>

      {/* Calendar grid */}
      {isLoading ? (
        <div className="border rounded-xl overflow-hidden bg-card animate-pulse">
          <div className="grid grid-cols-7 border-b bg-muted/50">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2 text-center text-xs text-muted-foreground">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="min-h-[80px] border-r border-b bg-muted/10" />
            ))}
          </div>
        </div>
      ) : (
        <CalendarGrid
          currentMonth={currentMonth}
          events={events}
          onDayClick={handleDayClick}
          onEventClick={handleEventClick}
        />
      )}

      {/* Add Event Dialog */}
      <AddEventDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultDate={selectedDay}
      />

      {/* Event Detail Dialog */}
      <EventDetailDialog
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}
