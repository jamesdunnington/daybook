import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { expenseTransactions } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { and, eq, gte, lte, desc, count } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const type = searchParams.get('type');
  const categoryId = searchParams.get('categoryId');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  const conditions = [eq(expenseTransactions.userId, userId)];
  if (type === 'income' || type === 'expense') {
    conditions.push(eq(expenseTransactions.type, type));
  }
  if (categoryId) {
    conditions.push(eq(expenseTransactions.categoryId, categoryId));
  }
  if (from) {
    conditions.push(gte(expenseTransactions.date, new Date(from)));
  }
  if (to) {
    conditions.push(lte(expenseTransactions.date, new Date(to)));
  }

  const where = and(...conditions);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(expenseTransactions)
      .where(where)
      .orderBy(desc(expenseTransactions.date))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(expenseTransactions).where(where),
  ]);

  return NextResponse.json({
    data: rows,
    total: totalRow?.total ?? 0,
    page,
    limit,
  });
}

export async function POST(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { type, amount, description, date, categoryId, notes, merchant } = body;

  if (!type || (type !== 'income' && type !== 'expense')) {
    return NextResponse.json({ error: 'type must be income or expense' }, { status: 400 });
  }
  if (!amount || isNaN(parseFloat(amount))) {
    return NextResponse.json({ error: 'amount must be a valid number' }, { status: 400 });
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }
  if (!date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 });
  }

  const [row] = await db
    .insert(expenseTransactions)
    .values({
      userId,
      type,
      amount: parseFloat(amount).toFixed(2),
      description: description.trim(),
      date: new Date(date),
      categoryId: categoryId ?? null,
      notes: notes ?? null,
      merchant: merchant ?? null,
      importedFrom: 'manual',
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
