import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { projectPages } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { recordUndo } from '@/lib/ai/undo';
import { eq, and } from 'drizzle-orm';

async function getUserId() {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  return apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
}

async function findOwned(pageId: string, userId: string) {
  const [row] = await db
    .select()
    .from(projectPages)
    .where(and(eq(projectPages.id, pageId), eq(projectPages.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { pageId } = await params;

  const page = await findOwned(pageId, userId);
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(page);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { pageId } = await params;

  const existing = await findOwned(pageId, userId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof projectPages.$inferInsert> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.content !== undefined) updates.content = body.content;
  if (body.parentId !== undefined) updates.parentId = body.parentId;
  if (body.position !== undefined) updates.position = body.position;

  const [updated] = await db
    .update(projectPages)
    .set(updates)
    .where(eq(projectPages.id, pageId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { pageId } = await params;

  const existing = await findOwned(pageId, userId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.delete(projectPages).where(eq(projectPages.id, pageId));

  const undo = await recordUndo({
    userId,
    conversationId: null,
    toolName: 'delete_project_page',
    summary: `Deleted page "${existing.title}"`,
    undoData: { kind: 'restore_row', table: 'projectPages', row: existing },
  });

  return NextResponse.json({ success: true, undoId: undo.id, undoExpiresAt: undo.expiresAt.toISOString() });
}
