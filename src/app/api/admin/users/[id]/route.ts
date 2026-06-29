import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/server';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  // Prevent admin from demoting themselves
  if (id === session!.user.id) {
    return NextResponse.json({ error: 'Cannot modify your own account here' }, { status: 400 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.role !== undefined) updates.role = body.role;
  if (body.banned !== undefined) {
    updates.banned = body.banned;
    updates.banReason = body.banReason ?? null;
    updates.banExpires = body.banExpires ? new Date(body.banExpires) : null;
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  }

  await db.update(user).set(updates).where(eq(user.id, id));
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  if (id === session!.user.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  await db.delete(user).where(eq(user.id, id));
  return NextResponse.json({ success: true });
}
