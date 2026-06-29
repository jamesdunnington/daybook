import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { journalEntries, journalPhotos } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuid } from 'uuid';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId =
    apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: entryId } = await params;

  // Verify entry belongs to user
  const entry = await db.query.journalEntries.findFirst({
    where: and(eq(journalEntries.id, entryId), eq(journalEntries.userId, userId)),
  });
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const files = formData.getAll('photos') as File[];
  if (!files.length) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  // Ensure upload directory exists
  const uploadDir = path.join(UPLOAD_DIR, 'journal', userId);
  await fs.mkdir(uploadDir, { recursive: true });

  const created = [];

  for (const file of files) {
    // Validate mime type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: `File "${file.name}" is not an image` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File "${file.name}" exceeds 10MB limit` },
        { status: 400 }
      );
    }

    // Generate filename with original extension
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const filename = `${uuid()}.${ext}`;
    const filePath = path.join(uploadDir, filename);

    // Write file to disk
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // Get current max sort order
    const existing = await db
      .select({ sortOrder: journalPhotos.sortOrder })
      .from(journalPhotos)
      .where(eq(journalPhotos.entryId, entryId))
      .orderBy(journalPhotos.sortOrder);

    const nextOrder = existing.length > 0
      ? (existing[existing.length - 1].sortOrder ?? 0) + 1
      : 0;

    // Insert DB record
    const [photo] = await db
      .insert(journalPhotos)
      .values({
        entryId,
        userId,
        filename,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        sortOrder: nextOrder,
      })
      .returning();

    created.push(photo);
  }

  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId =
    apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: entryId } = await params;
  const { searchParams } = new URL(req.url);
  const photoId = searchParams.get('photoId');

  if (!photoId) {
    return NextResponse.json({ error: 'photoId query param required' }, { status: 400 });
  }

  // Verify photo belongs to this user and entry
  const photo = await db.query.journalPhotos.findFirst({
    where: and(
      eq(journalPhotos.id, photoId),
      eq(journalPhotos.entryId, entryId),
      eq(journalPhotos.userId, userId)
    ),
  });

  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Delete file from disk
  const filePath = path.join(UPLOAD_DIR, 'journal', userId, photo.filename);
  await fs.unlink(filePath).catch(() => {});

  // Delete DB record
  await db.delete(journalPhotos).where(eq(journalPhotos.id, photoId));

  return NextResponse.json({ success: true });
}
