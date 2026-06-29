import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { expenseTransactions, expenseCategories } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { and, eq, gte, lte, sql, sum } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const groupBy = searchParams.get('groupBy') ?? 'month';

  const conditions = [eq(expenseTransactions.userId, userId)];
  if (from) conditions.push(gte(expenseTransactions.date, new Date(from)));
  if (to) conditions.push(lte(expenseTransactions.date, new Date(to)));

  const where = and(...conditions);

  // Totals
  const [totals] = await db
    .select({
      totalIncome: sql<string>`COALESCE(SUM(CASE WHEN ${expenseTransactions.type} = 'income' THEN ${expenseTransactions.amount} ELSE 0 END), 0)`,
      totalExpense: sql<string>`COALESCE(SUM(CASE WHEN ${expenseTransactions.type} = 'expense' THEN ${expenseTransactions.amount} ELSE 0 END), 0)`,
    })
    .from(expenseTransactions)
    .where(where);

  const totalIncome = parseFloat(totals?.totalIncome ?? '0');
  const totalExpense = parseFloat(totals?.totalExpense ?? '0');
  const netPL = totalIncome - totalExpense;

  if (groupBy === 'category') {
    const rows = await db
      .select({
        categoryId: expenseTransactions.categoryId,
        categoryName: expenseCategories.name,
        type: expenseTransactions.type,
        total: sum(expenseTransactions.amount),
      })
      .from(expenseTransactions)
      .leftJoin(
        expenseCategories,
        eq(expenseTransactions.categoryId, expenseCategories.id)
      )
      .where(where)
      .groupBy(
        expenseTransactions.categoryId,
        expenseCategories.name,
        expenseTransactions.type
      )
      .orderBy(expenseTransactions.type, sql`SUM(${expenseTransactions.amount}) DESC`);

    const data = rows.map((r) => ({
      categoryId: r.categoryId ?? null,
      categoryName: r.categoryName ?? 'Uncategorized',
      type: r.type,
      total: parseFloat(r.total ?? '0'),
    }));

    return NextResponse.json({ totalIncome, totalExpense, netPL, data });
  }

  // groupBy=month (default)
  const rows = await db
    .select({
      period: sql<string>`TO_CHAR(DATE_TRUNC('month', ${expenseTransactions.date}), 'YYYY-MM')`,
      income: sql<string>`COALESCE(SUM(CASE WHEN ${expenseTransactions.type} = 'income' THEN ${expenseTransactions.amount} ELSE 0 END), 0)`,
      expense: sql<string>`COALESCE(SUM(CASE WHEN ${expenseTransactions.type} = 'expense' THEN ${expenseTransactions.amount} ELSE 0 END), 0)`,
    })
    .from(expenseTransactions)
    .where(where)
    .groupBy(sql`DATE_TRUNC('month', ${expenseTransactions.date})`)
    .orderBy(sql`DATE_TRUNC('month', ${expenseTransactions.date}) ASC`);

  const data = rows.map((r) => ({
    period: r.period,
    income: parseFloat(r.income),
    expense: parseFloat(r.expense),
    net: parseFloat(r.income) - parseFloat(r.expense),
  }));

  return NextResponse.json({ totalIncome, totalExpense, netPL, data });
}
