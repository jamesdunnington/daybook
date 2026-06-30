import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { expenseCategories, expenseTransactions } from '@/lib/db/schema';
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
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, id), eq(expenseCategories.userId, userId)));

  if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Unassign transactions that used this category before deleting
  await db
    .update(expenseTransactions)
    .set({ categoryId: null })
    .where(and(eq(expenseTransactions.categoryId, id), eq(expenseTransactions.userId, userId)));

  await db
    .delete(expenseCategories)
    .where(and(eq(expenseCategories.id, id), eq(expenseCategories.userId, userId)));

  return new NextResponse(null, { status: 204 });
}
