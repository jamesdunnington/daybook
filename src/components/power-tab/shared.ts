import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

export interface LogEntry {
  id: string;
  content: string;
  entryDate: string;
  milestoneId: string | null;
  countValue: string;
  /** Planned target date; null = open, follows the milestone's date. */
  targetDate: string | null;
  /** Null while the item is still planned. */
  completedAt: string | null;
  createdAt: string;
}

export interface Forecast {
  progressSoFar: number;
  targetCount: number;
  percentComplete: number;
  remaining: number;
  pacePerDay: number | null;
  forecastDate: string | null;
  note: string;
}

export interface ItemCounts {
  done: number;
  open: number;
  named: number;
  overdue: number;
}

export interface Milestone {
  id: string;
  title: string;
  unitLabel: string;
  targetCount: string;
  targetDate: string | null;
  /** 'active' | 'completed' | 'abandoned' */
  status: string;
  forecast: Forecast;
  itemCounts: ItemCounts;
}

export const jsonHeaders = { 'Content-Type': 'application/json' };

/** The server's error message if it sent one, otherwise the fallback. */
export async function readError(r: Response, fallback: string): Promise<string> {
  const body = await r.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : fallback;
}

/** "2026-10-30" from an ISO timestamp — dates are day-granular, so compare as strings. */
export function dayString(iso: string): string {
  return iso.slice(0, 10);
}

export function todayString(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** Formats a day-granular ISO date without letting the timezone shift it by a day. */
export function formatDay(iso: string, pattern = 'MMM d, yyyy'): string {
  const [y, m, d] = dayString(iso).split('-').map(Number);
  return format(new Date(y, m - 1, d), pattern);
}

/** Refreshes everything a log/milestone change can touch, including the project's own status. */
export function useRefreshPowerTab(projectId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['power-tab-log', projectId] });
    queryClient.invalidateQueries({ queryKey: ['power-tab-milestones', projectId] });
    queryClient.invalidateQueries({ queryKey: ['power-tab-project', projectId] });
    queryClient.invalidateQueries({ queryKey: ['power-tab-projects'] });
  };
}
