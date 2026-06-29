import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { headers } from 'next/headers';
import fs from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

// Map common extensions to MIME types
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] ?? 'application/octet-stream';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const sess = await requireSession();
  const requestingUserId = apiKeySession?.userId ?? sess.session?.user?.id;
  const requestingUserRole = apiKeySession?.userRole ?? sess.session?.user?.role;

  if (!requestingUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { path: pathSegments } = await params;

  // Path structure: journal/<userId>/<filename>
  // Verify the userId in the path matches requesting user (admins can access any)
  if (pathSegments.length < 3) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const ownerUserId = pathSegments[1];
  const isAdmin = requestingUserRole === 'admin';

  if (!isAdmin && ownerUserId !== requestingUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const filePath = path.join(UPLOAD_DIR, ...pathSegments);

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(filePath) as Buffer;
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filename = pathSegments[pathSegments.length - 1];
  const contentType = getMimeType(filename);

  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
      'Content-Length': String(fileBuffer.length),
    },
  });
}
