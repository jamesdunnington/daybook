import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { todos } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { and, eq, asc, desc, max } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const categoryId = searchParams.get('categoryId');
  const status = searchParams.get('status');
  const priority = searchParams.get('priority');

  const conditions = [eq(todos.userId, userId)];
  if (categoryId) conditions.push(eq(todos.categoryId, categoryId));
  if (status) conditions.push(eq(todos.status, status));
  if (priority) conditions.push(eq(todos.priority, priority));

  const rows = await db
    .select()
    .from(todos)
    .where(and(...conditions))
    .orderBy(asc(todos.position), desc(todos.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { title, description, priority, categoryId, dueDate, status } = body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  // Get max position for this user
  const [maxRow] = await db
    .select({ maxPos: max(todos.position) })
    .from(todos)
    .where(eq(todos.userId, userId));

  const position = (maxRow?.maxPos ?? 0) + 1;

  const [todo] = await db
    .insert(todos)
    .values({
      userId,
      title: title.trim(),
      description: description ?? null,
      priority: priority ?? 'medium',
      status: status ?? 'pending',
      categoryId: categoryId ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      position,
    })
    .returning();

  return NextResponse.json(todo, { status: 201 });
}
