import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Raster formats only: SVG is deliberately excluded because /api/uploads serves
// it as image/svg+xml, which can carry script.
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

// Stores an image dropped, picked or pasted into a project page and returns the
// URL the block editor should store (served by /api/uploads/[...path]).
export async function POST(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    return NextResponse.json({ error: 'Only PNG, JPEG, GIF, WebP, AVIF or BMP images are supported' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'Image exceeds the 10MB limit' }, { status: 400 });
  }

  const dir = path.join(UPLOAD_DIR, 'power-tab', userId);
  await fs.mkdir(dir, { recursive: true });
  const filename = `${uuid()}.${ext}`;
  await fs.writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ url: `/api/uploads/power-tab/${userId}/${filename}` }, { status: 201 });
}
