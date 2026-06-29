import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/server';
import { db } from '@/lib/db';
import { apiKeys } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateApiKey } from '@/lib/auth/api-key';

export async function GET() {
  const { session, error } = await requireSession();
  if (error) return error;

  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, session!.user.id),
    columns: { keyHash: false },
  });
  return NextResponse.json(keys);
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession();
  if (error) return error;

  const body = await req.json();
  const { name, scopes, expiresAt } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { token, prefix, hash } = generateApiKey();

  const [key] = await db
    .insert(apiKeys)
    .values({
      userId: session!.user.id,
      name,
      keyHash: hash,
      keyPrefix: prefix,
      scopes: scopes ?? [],
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    .returning({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, createdAt: apiKeys.createdAt });

  // Return full token ONCE — never stored again
  return NextResponse.json({ ...key, token }, { status: 201 });
}
