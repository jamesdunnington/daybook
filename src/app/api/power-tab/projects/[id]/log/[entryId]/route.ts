import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { projectActivityLog, projectMilestones } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { eq, and } from 'drizzle-orm';

async function getUserId() {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  return apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
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

  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof projectActivityLog.$inferInsert> = {};
  if (body.content !== undefined) updates.content = body.content;
  if (body.entryDate !== undefined) updates.entryDate = new Date(body.entryDate);
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
  return NextResponse.json({ success: true });
}
