import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { projectMilestones } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { recordUndo } from '@/lib/ai/undo';
import { syncOpenSlots, syncProjectStatus } from '@/lib/power-tab/items';
import { eq, and } from 'drizzle-orm';

async function getUserId() {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  return apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; milestoneId: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { milestoneId } = await params;

  const [existing] = await db
    .select()
    .from(projectMilestones)
    .where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.userId, userId)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof projectMilestones.$inferInsert> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.unitLabel !== undefined) updates.unitLabel = body.unitLabel;
  if (body.targetDate !== undefined) {
    // Every milestone needs a finish date; open items fall back to it.
    if (!body.targetDate || Number.isNaN(new Date(body.targetDate).getTime())) {
      return NextResponse.json({ error: 'targetDate is required' }, { status: 400 });
    }
    updates.targetDate = new Date(body.targetDate);
  }
  if (body.status !== undefined) {
    if (!['active', 'completed', 'abandoned'].includes(body.status)) {
      return NextResponse.json({ error: "status must be 'active', 'completed' or 'abandoned'" }, { status: 400 });
    }
    updates.status = body.status;
  }

  if (body.targetCount !== undefined) {
    if ((updates.status ?? existing.status) === 'abandoned') {
      return NextResponse.json({ error: 'Restore the milestone before changing its target.' }, { status: 400 });
    }
    const target = Math.floor(Number(body.targetCount));
    if (!Number.isFinite(target) || target < 1) {
      return NextResponse.json({ error: 'targetCount must be at least 1' }, { status: 400 });
    }
    // Add or remove empty slots so the item list always matches the new target.
    const synced = await syncOpenSlots({
      projectId: existing.projectId,
      userId,
      milestoneId,
      targetCount: target,
    });
    if (!synced.ok) return NextResponse.json({ error: synced.error }, { status: 400 });
    updates.targetCount = String(target);
  }

  const [updated] = await db
    .update(projectMilestones)
    .set(updates)
    .where(eq(projectMilestones.id, milestoneId))
    .returning();

  await syncProjectStatus(existing.projectId);

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; milestoneId: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { milestoneId } = await params;

  const [existing] = await db
    .select()
    .from(projectMilestones)
    .where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.userId, userId)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.delete(projectMilestones).where(eq(projectMilestones.id, milestoneId));
  await syncProjectStatus(existing.projectId);

  const undo = await recordUndo({
    userId,
    conversationId: null,
    toolName: 'delete_milestone',
    summary: `Deleted milestone "${existing.title}"`,
    undoData: { kind: 'restore_row', table: 'projectMilestones', row: existing },
  });

  return NextResponse.json({ success: true, undoId: undo.id, undoExpiresAt: undo.expiresAt.toISOString() });
}
