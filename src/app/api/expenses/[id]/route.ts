import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { expenseTransactions } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { and, eq } from 'drizzle-orm';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const existing = await db
    .select()
    .from(expenseTransactions)
    .where(and(eq(expenseTransactions.id, id), eq(expenseTransactions.userId, userId)))
    .limit(1);

  if (!existing.length) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  const updates: Partial<typeof expenseTransactions.$inferInsert> = {};

  if (body.type !== undefined) {
    if (body.type !== 'income' && body.type !== 'expense') {
      return NextResponse.json({ error: 'type must be income or expense' }, { status: 400 });
    }
    updates.type = body.type;
  }
  if (body.amount !== undefined) {
    const parsed = parseFloat(body.amount);
    if (isNaN(parsed)) {
      return NextResponse.json({ error: 'amount must be a valid number' }, { status: 400 });
    }
    updates.amount = parsed.toFixed(2);
  }
  if (body.description !== undefined) updates.description = body.description;
  if (body.date !== undefined) updates.date = new Date(body.date);
  if (body.categoryId !== undefined) updates.categoryId = body.categoryId;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.merchant !== undefined) updates.merchant = body.merchant;
  if (body.receiptUrl !== undefined) updates.receiptUrl = body.receiptUrl;
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(expenseTransactions)
    .set(updates)
    .where(and(eq(expenseTransactions.id, id), eq(expenseTransactions.userId, userId)))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const existing = await db
    .select()
    .from(expenseTransactions)
    .where(and(eq(expenseTransactions.id, id), eq(expenseTransactions.userId, userId)))
    .limit(1);

  if (!existing.length) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  await db
    .delete(expenseTransactions)
    .where(and(eq(expenseTransactions.id, id), eq(expenseTransactions.userId, userId)));

  return NextResponse.json({ success: true });
}
