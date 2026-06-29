import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { db } from '@/lib/db';
import { expenseTransactions } from '@/lib/db/schema';

async function getUserId() {
  const hdrs = await headers();
  const apiKey = await validateApiKey(hdrs.get('authorization'));
  if (apiKey) return apiKey.userId;
  const { session } = await requireSession();
  return session?.user?.id ?? null;
}

interface ImportRow {
  date: string;
  amount: number;
  type: 'income' | 'expense';
  description: string;
  merchant: string | null;
  categoryId?: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await params;

  const body = await req.json();
  const { importBatchId, transactions } = body as {
    importBatchId: string;
    transactions: ImportRow[];
  };

  if (!importBatchId || !Array.isArray(transactions) || !transactions.length) {
    return NextResponse.json({ error: 'importBatchId and transactions are required' }, { status: 400 });
  }

  const rows = transactions.map((t) => ({
    userId,
    type: t.type,
    amount: String(t.amount),
    description: t.description,
    date: new Date(t.date),
    merchant: t.merchant ?? null,
    categoryId: t.categoryId ?? null,
    importedFrom: 'csv' as const,
    importBatchId,
  }));

  await db.insert(expenseTransactions).values(rows);

  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  return NextResponse.json({
    imported: rows.length,
    importBatchId,
    summary: {
      income: income.toFixed(2),
      expense: expense.toFixed(2),
      net: (income - expense).toFixed(2),
    },
  });
}
