// Planned milestone items: each milestone's target count is backed by that many
// activity-log rows ("slots"). A row with completedAt = null is still planned; ticking
// it sets completedAt and counts it toward the milestone.
// See docs/superpowers/specs/2026-10-18-milestone-planned-items-design.md.

import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projectActivityLog, projectMilestones, projects } from '@/lib/db/schema';

export const MAX_MILESTONE_ITEMS = 500;

export function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

type SyncResult = { ok: true } | { ok: false; error: string };

/**
 * Makes the number of still-open slots equal what's left of the target
 * (target − completed progress), adding blank slots or removing blank ones.
 * Named slots are never deleted: if the target would drop below them it fails instead.
 */
export async function syncOpenSlots(args: {
  projectId: string;
  userId: string;
  milestoneId: string;
  targetCount: number;
}): Promise<SyncResult> {
  const { projectId, userId, milestoneId, targetCount } = args;

  const rows = await db
    .select({
      id: projectActivityLog.id,
      content: projectActivityLog.content,
      countValue: projectActivityLog.countValue,
      completedAt: projectActivityLog.completedAt,
    })
    .from(projectActivityLog)
    .where(eq(projectActivityLog.milestoneId, milestoneId))
    .orderBy(asc(projectActivityLog.createdAt));

  const progress = rows
    .filter((r) => r.completedAt)
    .reduce((sum, r) => sum + parseFloat(r.countValue), 0);
  const open = rows.filter((r) => !r.completedAt);
  const wanted = Math.max(Math.ceil(targetCount - progress), 0);

  if (wanted > MAX_MILESTONE_ITEMS) {
    return { ok: false, error: `A milestone can have at most ${MAX_MILESTONE_ITEMS} open targets.` };
  }

  if (open.length < wanted) {
    const base = Date.now();
    await db.insert(projectActivityLog).values(
      Array.from({ length: wanted - open.length }, (_, i) => ({
        projectId,
        userId,
        milestoneId,
        content: '',
        createdAt: new Date(base + i),
      }))
    );
  } else if (open.length > wanted) {
    const blanks = open.filter((r) => !r.content.trim()).reverse(); // newest blanks go first
    const excess = open.length - wanted;
    if (blanks.length < excess) {
      const short = excess - blanks.length;
      return {
        ok: false,
        error: `Not enough empty targets to remove — complete or delete ${short} named target${
          short === 1 ? '' : 's'
        } before lowering the target count.`,
      };
    }
    await db.delete(projectActivityLog).where(
      inArray(
        projectActivityLog.id,
        blanks.slice(0, excess).map((r) => r.id)
      )
    );
  }

  return { ok: true };
}

/** Sets a milestone's target count to exactly (completed progress + open slots). */
export async function recountMilestoneTarget(milestoneId: string): Promise<void> {
  const rows = await db
    .select({
      countValue: projectActivityLog.countValue,
      completedAt: projectActivityLog.completedAt,
    })
    .from(projectActivityLog)
    .where(eq(projectActivityLog.milestoneId, milestoneId));

  const done = rows
    .filter((r) => r.completedAt)
    .reduce((sum, r) => sum + parseFloat(r.countValue), 0);
  const open = rows.filter((r) => !r.completedAt).length;

  await db
    .update(projectMilestones)
    .set({ targetCount: String(Math.max(done + open, 1)), updatedAt: new Date() })
    .where(eq(projectMilestones.id, milestoneId));
}

/**
 * A project is complete once it has milestones and every one is at 100%; adding a milestone
 * (or a target, or unticking an item) reopens it. A project with no milestones keeps whatever
 * status it has, so the manual complete/reopen button still works there.
 */
export async function syncProjectStatus(projectId: string): Promise<void> {
  // Abandoned milestones are out of the running: they neither block nor count toward completion.
  const milestones = await db
    .select({ id: projectMilestones.id, targetCount: projectMilestones.targetCount })
    .from(projectMilestones)
    .where(and(eq(projectMilestones.projectId, projectId), ne(projectMilestones.status, 'abandoned')));
  if (milestones.length === 0) return;

  const doneRows = await db
    .select({
      milestoneId: projectActivityLog.milestoneId,
      countValue: projectActivityLog.countValue,
    })
    .from(projectActivityLog)
    .where(and(eq(projectActivityLog.projectId, projectId), isNotNull(projectActivityLog.completedAt)));

  const progress = new Map<string, number>();
  for (const r of doneRows) {
    if (r.milestoneId) progress.set(r.milestoneId, (progress.get(r.milestoneId) ?? 0) + parseFloat(r.countValue));
  }

  const allDone = milestones.every((m) => (progress.get(m.id) ?? 0) >= parseFloat(m.targetCount));
  const next = allDone ? 'completed' : 'active';

  await db
    .update(projects)
    .set({ status: next, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), ne(projects.status, next)));
}

/** Oldest empty open slot of a milestone — what a quick "I did X" fills in. */
export async function firstBlankOpenSlot(milestoneId: string) {
  const [row] = await db
    .select()
    .from(projectActivityLog)
    .where(
      and(
        eq(projectActivityLog.milestoneId, milestoneId),
        isNull(projectActivityLog.completedAt),
        sql`btrim(${projectActivityLog.content}) = ''`
      )
    )
    .orderBy(asc(projectActivityLog.createdAt))
    .limit(1);
  return row ?? null;
}
