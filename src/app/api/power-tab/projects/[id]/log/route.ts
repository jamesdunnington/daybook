import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { projects, projectActivityLog, projectMilestones } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import {
  firstBlankOpenSlot,
  recountMilestoneTarget,
  syncOpenSlots,
  syncProjectStatus,
} from '@/lib/power-tab/items';
import { eq, and, desc } from 'drizzle-orm';

async function getUserId() {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  return apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
}

async function ownsProject(projectId: string, userId: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return !!row;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await ownsProject(id, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await db
    .select()
    .from(projectActivityLog)
    .where(eq(projectActivityLog.projectId, id))
    .orderBy(desc(projectActivityLog.entryDate));

  return NextResponse.json(rows);
}

/**
 * Two kinds of POST:
 *  - `planned: true` + `milestoneId`: adds one more (optionally named) target to the milestone,
 *    which raises its target count by one. Content may be empty.
 *  - otherwise: logs finished work. Linked to a milestone with the default count it fills that
 *    milestone's next empty target instead of adding a new row, so the target count stays put.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await ownsProject(id, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const planned = body.planned === true;
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!planned && !content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }
  if (planned && !body.milestoneId) {
    return NextResponse.json({ error: 'milestoneId is required for a planned target' }, { status: 400 });
  }
  if (body.targetDate && Number.isNaN(new Date(body.targetDate).getTime())) {
    return NextResponse.json({ error: 'targetDate is not a valid date' }, { status: 400 });
  }

  let milestone: typeof projectMilestones.$inferSelect | undefined;
  if (body.milestoneId) {
    [milestone] = await db
      .select()
      .from(projectMilestones)
      .where(and(eq(projectMilestones.id, body.milestoneId), eq(projectMilestones.projectId, id)))
      .limit(1);
    if (!milestone) return NextResponse.json({ error: 'Milestone not found in this project' }, { status: 400 });
    if (milestone.status === 'abandoned') {
      return NextResponse.json({ error: 'This milestone is abandoned — restore it first.' }, { status: 400 });
    }
  }

  const targetDate = body.targetDate ? new Date(body.targetDate) : null;

  if (planned && milestone) {
    const [entry] = await db
      .insert(projectActivityLog)
      .values({ projectId: id, userId, milestoneId: milestone.id, content, targetDate })
      .returning();
    await recountMilestoneTarget(milestone.id);
    await syncProjectStatus(id);
    return NextResponse.json(entry, { status: 201 });
  }

  const now = new Date();
  const entryDate = body.entryDate ? new Date(body.entryDate) : now;
  const countValue = body.countValue !== undefined ? String(body.countValue) : '1';

  if (milestone && countValue === '1') {
    const slot = await firstBlankOpenSlot(milestone.id);
    if (slot) {
      const [entry] = await db
        .update(projectActivityLog)
        .set({ content, entryDate, completedAt: now })
        .where(eq(projectActivityLog.id, slot.id))
        .returning();
      await syncProjectStatus(id);
      return NextResponse.json(entry, { status: 201 });
    }
  }

  const [entry] = await db
    .insert(projectActivityLog)
    .values({
      projectId: id,
      userId,
      content,
      entryDate,
      milestoneId: milestone?.id ?? null,
      countValue,
      targetDate,
      completedAt: now,
    })
    .returning();

  // Finished work beyond the plan shrinks what's left, so drop a now-surplus empty target.
  if (milestone) {
    await syncOpenSlots({
      projectId: id,
      userId,
      milestoneId: milestone.id,
      targetCount: parseFloat(milestone.targetCount),
    });
    await syncProjectStatus(id);
  }

  return NextResponse.json(entry, { status: 201 });
}
