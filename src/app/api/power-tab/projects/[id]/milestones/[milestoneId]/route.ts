import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { projectMilestones } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { recordUndo } from '@/lib/ai/undo';
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
  if (body.targetCount !== undefined) updates.targetCount = String(body.targetCount);
  if (body.targetDate !== undefined) updates.targetDate = body.targetDate ? new Date(body.targetDate) : null;
  if (body.status !== undefined) updates.status = body.status;

  const [updated] = await db
    .update(projectMilestones)
    .set(updates)
    .where(eq(projectMilestones.id, milestoneId))
    .returning();

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

  const undo = await recordUndo({
    userId,
    conversationId: null,
    toolName: 'delete_milestone',
    summary: `Deleted milestone "${existing.title}"`,
    undoData: { kind: 'restore_row', table: 'projectMilestones', row: existing },
  });

  return NextResponse.json({ success: true, undoId: undo.id, undoExpiresAt: undo.expiresAt.toISOString() });
}
