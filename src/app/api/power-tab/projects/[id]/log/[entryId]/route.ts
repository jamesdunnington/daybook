import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { projectActivityLog, projectMilestones } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { recountMilestoneTarget, syncOpenSlots, syncProjectStatus } from '@/lib/power-tab/items';
import { eq, and } from 'drizzle-orm';

async function getUserId() {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  return apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
}

/** After an item moves in or out of a milestone, put that milestone's open slots back in step. */
async function rebalance(args: {
  milestoneId: string | null;
  projectId: string;
  userId: string;
  itemWasOpen: boolean;
}) {
  const { milestoneId, projectId, userId, itemWasOpen } = args;
  if (!milestoneId) return;
  if (itemWasOpen) {
    // An open item is itself a target: the target count follows it.
    await recountMilestoneTarget(milestoneId);
    return;
  }
  const [m] = await db
    .select({ targetCount: projectMilestones.targetCount })
    .from(projectMilestones)
    .where(eq(projectMilestones.id, milestoneId))
    .limit(1);
  if (m) {
    await syncOpenSlots({ projectId, userId, milestoneId, targetCount: parseFloat(m.targetCount) });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { entryId } = await params;

  const [existing] = await db
    .select()
    .from(projectActivityLog)
    .where(and(eq(projectActivityLog.id, entryId), eq(projectActivityLog.userId, userId)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (existing.milestoneId) {
    const [owner] = await db
      .select({ status: projectMilestones.status })
      .from(projectMilestones)
      .where(eq(projectMilestones.id, existing.milestoneId))
      .limit(1);
    if (owner?.status === 'abandoned') {
      return NextResponse.json({ error: 'This milestone is abandoned — restore it first.' }, { status: 400 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof projectActivityLog.$inferInsert> = {};
  if (body.content !== undefined) updates.content = body.content;
  if (body.entryDate !== undefined) updates.entryDate = new Date(body.entryDate);
  if (body.targetDate !== undefined) {
    if (body.targetDate !== null && Number.isNaN(new Date(body.targetDate).getTime())) {
      return NextResponse.json({ error: 'targetDate is not a valid date' }, { status: 400 });
    }
    // null = open: the item follows its milestone's date again.
    updates.targetDate = body.targetDate ? new Date(body.targetDate) : null;
  }
  if (body.completed !== undefined) {
    updates.completedAt = body.completed ? (existing.completedAt ?? new Date()) : null;
  }
  if (body.milestoneId !== undefined) {
    if (body.milestoneId !== null) {
      const [milestone] = await db
        .select({ id: projectMilestones.id })
        .from(projectMilestones)
        .where(and(eq(projectMilestones.id, body.milestoneId), eq(projectMilestones.projectId, existing.projectId)))
        .limit(1);
      if (!milestone) return NextResponse.json({ error: 'Milestone not found in this project' }, { status: 400 });
    }
    updates.milestoneId = body.milestoneId;
  }
  if (body.countValue !== undefined) updates.countValue = String(body.countValue);

  const [updated] = await db
    .update(projectActivityLog)
    .set(updates)
    .where(eq(projectActivityLog.id, entryId))
    .returning();

  if (body.milestoneId !== undefined && body.milestoneId !== existing.milestoneId) {
    const itemWasOpen = !updated.completedAt;
    for (const milestoneId of [existing.milestoneId, updated.milestoneId]) {
      await rebalance({ milestoneId, projectId: existing.projectId, userId, itemWasOpen });
    }
  }

  await syncProjectStatus(existing.projectId);

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { entryId } = await params;

  const [existing] = await db
    .select()
    .from(projectActivityLog)
    .where(and(eq(projectActivityLog.id, entryId), eq(projectActivityLog.userId, userId)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.delete(projectActivityLog).where(eq(projectActivityLog.id, entryId));
  await rebalance({
    milestoneId: existing.milestoneId,
    projectId: existing.projectId,
    userId,
    itemWasOpen: !existing.completedAt,
  });
  await syncProjectStatus(existing.projectId);
  return NextResponse.json({ success: true });
}
