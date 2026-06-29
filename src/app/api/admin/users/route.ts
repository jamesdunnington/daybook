import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/server';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';

export async function GET() {
  const { session, error } = await requireAdmin();
  if (error) return error;

  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt));

  return NextResponse.json(users);
}
