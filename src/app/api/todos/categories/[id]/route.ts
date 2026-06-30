import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { todoCategories, todos } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { eq, and } from 'drizzle-orm';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [category] = await db
    .select()
    .from(todoCategories)
    .where(and(eq(todoCategories.id, id), eq(todoCategories.userId, userId)));

  if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Unassign todos that used this category before deleting
  await db
    .update(todos)
    .set({ categoryId: null })
    .where(and(eq(todos.categoryId, id), eq(todos.userId, userId)));

  await db
    .delete(todoCategories)
    .where(and(eq(todoCategories.id, id), eq(todoCategories.userId, userId)));

  return new NextResponse(null, { status: 204 });
}
