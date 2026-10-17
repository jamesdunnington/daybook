import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { projects, projectPages } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { eq, and, asc } from 'drizzle-orm';

async function getUserId() {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  return apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownsProject(projectId: string, userId: string) {
  // A non-UUID id would make Postgres throw (invalid uuid syntax) and surface as an empty 500.
  if (!UUID_RE.test(projectId)) return false;
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return !!row;
}

// Returns a flat list (title/id/parentId/position only — not the heavy block
// content) that the client assembles into a tree for the page-tree sidebar.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await ownsProject(id, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await db
    .select({
      id: projectPages.id,
      title: projectPages.title,
      parentId: projectPages.parentId,
      position: projectPages.position,
      updatedAt: projectPages.updatedAt,
    })
    .from(projectPages)
    .where(eq(projectPages.projectId, id))
    .orderBy(asc(projectPages.position));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await ownsProject(id, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  const [page] = await db
    .insert(projectPages)
    .values({
      projectId: id,
      userId,
      title: body.title ?? 'Untitled',
      parentId: body.parentId ?? null,
      content: body.content ?? [],
    })
    .returning();

  return NextResponse.json(page, { status: 201 });
}
