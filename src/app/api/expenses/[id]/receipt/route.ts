import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { expenseTransactions } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { and, eq } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuid } from 'uuid';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/tiff', 'image/avif'];

export async function POST(
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

  if (!existing.length) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('receipt') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File must be an image (JPEG, PNG, WEBP, GIF, HEIC, TIFF, AVIF)' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const filename = `${uuid()}.${ext}`;
  const uploadDir = path.join(UPLOAD_DIR, 'receipts', userId);
  await fs.mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, filename);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  // Remove old receipt file if one exists
  const prev = existing[0].receiptUrl;
  if (prev) {
    const prevFilename = prev.split('/').pop();
    if (prevFilename) {
      await fs.unlink(path.join(UPLOAD_DIR, 'receipts', userId, prevFilename)).catch(() => {});
    }
  }

  const receiptUrl = `/api/uploads/receipts/${userId}/${filename}`;

  const [updated] = await db
    .update(expenseTransactions)
    .set({ receiptUrl, updatedAt: new Date() })
    .where(and(eq(expenseTransactions.id, id), eq(expenseTransactions.userId, userId)))
    .returning();

  return NextResponse.json({ receiptUrl: updated.receiptUrl }, { status: 201 });
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

  if (!existing.length) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

  const prev = existing[0].receiptUrl;
  if (prev) {
    const filename = prev.split('/').pop();
    if (filename) {
      await fs.unlink(path.join(UPLOAD_DIR, 'receipts', userId, filename)).catch(() => {});
    }
  }

  await db
    .update(expenseTransactions)
    .set({ receiptUrl: null, updatedAt: new Date() })
    .where(and(eq(expenseTransactions.id, id), eq(expenseTransactions.userId, userId)));

  return NextResponse.json({ success: true });
}
