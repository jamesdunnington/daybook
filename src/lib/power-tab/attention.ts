// Dashboard "needs attention" ranking for Power Tab projects. Pure ranking logic
// lives in rankProjectAttention so it can be tested without a database.

import { and, eq, isNotNull, max } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects, projectMilestones, projectActivityLog } from '@/lib/db/schema';
import { computeMilestoneForecast } from './forecast';

export type AttentionKind = 'overdue' | 'at_risk' | 'stale';

export interface AttentionItem {
  projectId: string;
  projectName: string;
  kind: AttentionKind;
  /** Plain-language reason shown on the dashboard. */
  reason: string;
  /** Higher is more urgent; only comparable across items. */
  score: number;
}

export interface AttentionProject {
  id: string;
  name: string;
  createdAt: Date;
}

export interface AttentionMilestone {
  projectId: string;
  title: string;
  targetCount: number;
  targetDate: Date | null;
  entries: Array<{ countValue: number; entryDate: Date }>;
}

const DAY_MS = 86400_000;
/** A milestone due within this many days counts as "due soon". */
const DUE_SOON_DAYS = 14;
/** A project with no logged activity for this many days counts as stale. */
const STALE_DAYS = 7;

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Returns every project that needs attention, most urgent first. Each project
 * appears at most once, with its single worst problem.
 *
 * Severity tiers: overdue milestone (3000+) > due-soon milestone that will miss
 * its date (2000+) > no activity for STALE_DAYS (1000+). Within a tier, the more
 * overdue / sooner due / longer idle project ranks higher.
 */
export function rankProjectAttention(
  activeProjects: AttentionProject[],
  milestones: AttentionMilestone[],
  lastActivityByProject: Map<string, Date>,
  now: Date = new Date()
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const project of activeProjects) {
    const candidates: AttentionItem[] = [];

    for (const m of milestones.filter((x) => x.projectId === project.id)) {
      if (!m.targetDate) continue;

      const progressSoFar = m.entries.reduce((sum, e) => sum + e.countValue, 0);
      if (progressSoFar >= m.targetCount) continue;
      const forecast = computeMilestoneForecast({
        targetCount: m.targetCount,
        progressSoFar,
        entries: m.entries,
      });
      const pct = Math.round(forecast.percentComplete);

      if (m.targetDate < now) {
        const daysLate = Math.max(daysBetween(now, m.targetDate), 0);
        candidates.push({
          projectId: project.id,
          projectName: project.name,
          kind: 'overdue',
          reason:
            daysLate === 0
              ? `Milestone "${m.title}" was due today and is ${pct}% done.`
              : `Milestone "${m.title}" was due ${plural(daysLate, 'day')} ago and is ${pct}% done.`,
          score: 3000 + daysLate,
        });
        continue;
      }

      const daysLeft = daysBetween(m.targetDate, now);
      if (daysLeft > DUE_SOON_DAYS) continue;

      const dueIn = daysLeft === 0 ? 'today' : `in ${plural(daysLeft, 'day')}`;
      if (forecast.forecastDate === null) {
        candidates.push({
          projectId: project.id,
          projectName: project.name,
          kind: 'at_risk',
          reason: `Milestone "${m.title}" is due ${dueIn} and is ${pct}% done, with no recent activity to forecast from.`,
          score: 2000 + (DUE_SOON_DAYS - daysLeft),
        });
      } else if (forecast.forecastDate > m.targetDate) {
        const forecastDays = Math.max(daysBetween(forecast.forecastDate, now), 0);
        candidates.push({
          projectId: project.id,
          projectName: project.name,
          kind: 'at_risk',
          reason: `Milestone "${m.title}" is due ${dueIn}. At your current pace you finish in ${plural(forecastDays, 'day')}.`,
          score: 2000 + (DUE_SOON_DAYS - daysLeft),
        });
      }
    }

    const lastActivity = lastActivityByProject.get(project.id) ?? project.createdAt;
    const idleDays = daysBetween(now, lastActivity);
    if (idleDays >= STALE_DAYS) {
      candidates.push({
        projectId: project.id,
        projectName: project.name,
        kind: 'stale',
        reason: lastActivityByProject.has(project.id)
          ? `No activity logged for ${plural(idleDays, 'day')}.`
          : `No activity logged since you created it ${plural(idleDays, 'day')} ago.`,
        score: 1000 + idleDays,
      });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      items.push(candidates[0]);
    }
  }

  return items.sort((a, b) => b.score - a.score);
}

export async function getProjectAttention(
  userId: string
): Promise<{ openProjects: number; attention: AttentionItem[] }> {
  const activeProjects = await db
    .select({ id: projects.id, name: projects.name, createdAt: projects.createdAt })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.status, 'active')));

  if (activeProjects.length === 0) return { openProjects: 0, attention: [] };

  const activeIds = new Set(activeProjects.map((p) => p.id));

  const milestoneRows = await db
    .select()
    .from(projectMilestones)
    .where(and(eq(projectMilestones.userId, userId), eq(projectMilestones.status, 'active')));

  // Only ticked items count as progress; planned (open) items are not activity yet.
  const milestoneEntries = await db
    .select({
      milestoneId: projectActivityLog.milestoneId,
      countValue: projectActivityLog.countValue,
      completedAt: projectActivityLog.completedAt,
    })
    .from(projectActivityLog)
    .where(
      and(
        eq(projectActivityLog.userId, userId),
        isNotNull(projectActivityLog.milestoneId),
        isNotNull(projectActivityLog.completedAt)
      )
    );

  const lastActivityRows = await db
    .select({ projectId: projectActivityLog.projectId, last: max(projectActivityLog.completedAt) })
    .from(projectActivityLog)
    .where(and(eq(projectActivityLog.userId, userId), isNotNull(projectActivityLog.completedAt)))
    .groupBy(projectActivityLog.projectId);

  const lastActivityByProject = new Map<string, Date>();
  for (const row of lastActivityRows) {
    if (row.last) lastActivityByProject.set(row.projectId, row.last);
  }

  const milestones: AttentionMilestone[] = milestoneRows
    .filter((m) => activeIds.has(m.projectId))
    .map((m) => ({
      projectId: m.projectId,
      title: m.title,
      targetCount: parseFloat(m.targetCount),
      targetDate: m.targetDate,
      entries: milestoneEntries
        .filter((e) => e.milestoneId === m.id)
        .map((e) => ({ countValue: parseFloat(e.countValue), entryDate: e.completedAt! })),
    }));

  return {
    openProjects: activeProjects.length,
    attention: rankProjectAttention(activeProjects, milestones, lastActivityByProject),
  };
}
