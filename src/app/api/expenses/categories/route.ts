import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { expenseCategories } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { eq, asc } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.userId, userId))
    .orderBy(asc(expenseCategories.type), asc(expenseCategories.name));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { name, type, color, icon } = body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!type || (type !== 'income' && type !== 'expense')) {
    return NextResponse.json({ error: 'type must be income or expense' }, { status: 400 });
  }

  const [row] = await db
    .insert(expenseCategories)
    .values({
      userId,
      name: name.trim(),
      type,
      color: color ?? '#10b981',
      icon: icon ?? null,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
