import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { expenseTransactions, expenseCategories } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';
import { format } from 'date-fns';

export async function GET(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const type = searchParams.get('type');
  const categoryId = searchParams.get('categoryId');

  const conditions = [eq(expenseTransactions.userId, userId)];
  if (type === 'income' || type === 'expense') {
    conditions.push(eq(expenseTransactions.type, type));
  }
  if (categoryId) {
    conditions.push(eq(expenseTransactions.categoryId, categoryId));
  }
  if (from) conditions.push(gte(expenseTransactions.date, new Date(from)));
  if (to) conditions.push(lte(expenseTransactions.date, new Date(to)));

  const rows = await db
    .select({
      id: expenseTransactions.id,
      date: expenseTransactions.date,
      type: expenseTransactions.type,
      amount: expenseTransactions.amount,
      description: expenseTransactions.description,
      merchant: expenseTransactions.merchant,
      notes: expenseTransactions.notes,
      importedFrom: expenseTransactions.importedFrom,
      categoryName: expenseCategories.name,
    })
    .from(expenseTransactions)
    .leftJoin(
      expenseCategories,
      eq(expenseTransactions.categoryId, expenseCategories.id)
    )
    .where(and(...conditions))
    .orderBy(desc(expenseTransactions.date));

  const csvData = rows.map((r) => [
    format(new Date(r.date), 'yyyy-MM-dd'),
    r.type,
    r.amount,
    r.description,
    r.merchant ?? '',
    r.categoryName ?? '',
    r.notes ?? '',
    r.importedFrom ?? 'manual',
  ]);

  const csv = stringify([
    ['Date', 'Type', 'Amount', 'Description', 'Merchant', 'Category', 'Notes', 'ImportSource'],
    ...csvData,
  ]);

  const today = format(new Date(), 'yyyy-MM-dd');

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="daybook-expenses-${today}.csv"`,
    },
  });
}
