import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { projects, projectMilestones, projectActivityLog } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { computeMilestoneForecast } from '@/lib/power-tab/forecast';
import { MAX_MILESTONE_ITEMS, startOfToday, syncProjectStatus } from '@/lib/power-tab/items';
import { eq, and } from 'drizzle-orm';

async function getUserId() {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  return apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
}

async function ownsProject(projectId: string, userId: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return !!row;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await ownsProject(id, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const milestones = await db
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, id));

  const items = await db
    .select({
      milestoneId: projectActivityLog.milestoneId,
      content: projectActivityLog.content,
      countValue: projectActivityLog.countValue,
      targetDate: projectActivityLog.targetDate,
      completedAt: projectActivityLog.completedAt,
    })
    .from(projectActivityLog)
    .where(eq(projectActivityLog.projectId, id));

  const today = startOfToday();

  // Self-heals the project status after paths that skip the handlers (e.g. undoing a delete).
  await syncProjectStatus(id);

  const withForecast = milestones.map((m) => {
    const mine = items.filter((e) => e.milestoneId === m.id);
    const done = mine.filter((e) => e.completedAt);
    const open = mine.filter((e) => !e.completedAt);

    const progressSoFar = done.reduce((sum, e) => sum + parseFloat(e.countValue), 0);
    const forecast = computeMilestoneForecast({
      targetCount: parseFloat(m.targetCount),
      progressSoFar,
      entries: done.map((e) => ({ countValue: parseFloat(e.countValue), entryDate: e.completedAt! })),
    });

    // An open item with no date of its own is due when the milestone is.
    const overdue =
      m.status === 'abandoned'
        ? 0
        : open.filter((e) => {
            const due = e.targetDate ?? m.targetDate;
            return !!due && due < today;
          }).length;

    return {
      ...m,
      forecast,
      itemCounts: {
        done: done.length,
        open: open.length,
        named: open.filter((e) => e.content.trim()).length,
        overdue,
      },
    };
  });

  // Abandoned milestones sink to the end; otherwise keep creation order.
  withForecast.sort((a, b) => {
    const abandoned = Number(a.status === 'abandoned') - Number(b.status === 'abandoned');
    return abandoned || a.createdAt.getTime() - b.createdAt.getTime();
  });

  return NextResponse.json(withForecast);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await ownsProject(id, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (!body.title || !body.targetCount) {
    return NextResponse.json({ error: 'title and targetCount are required' }, { status: 400 });
  }
  if (!body.targetDate || Number.isNaN(new Date(body.targetDate).getTime())) {
    return NextResponse.json({ error: 'targetDate is required' }, { status: 400 });
  }

  // Optional names for the first targets; a blank box still counts as one target.
  const names: string[] = Array.isArray(body.items)
    ? body.items.map((n: unknown) => (typeof n === 'string' ? n.trim() : ''))
    : [];
  const count = Math.max(Math.floor(Number(body.targetCount)), names.length);
  if (!Number.isFinite(count) || count < 1 || count > MAX_MILESTONE_ITEMS) {
    return NextResponse.json(
      { error: `targetCount must be between 1 and ${MAX_MILESTONE_ITEMS}` },
      { status: 400 }
    );
  }

  const [milestone] = await db
    .insert(projectMilestones)
    .values({
      projectId: id,
      userId,
      title: body.title,
      unitLabel: body.unitLabel ?? 'items',
      targetCount: String(count),
      targetDate: new Date(body.targetDate),
    })
    .returning();

  // One slot per target. createdAt is staggered so the list keeps the order they were typed in.
  const base = Date.now();
  await db.insert(projectActivityLog).values(
    Array.from({ length: count }, (_, i) => ({
      projectId: id,
      userId,
      milestoneId: milestone.id,
      content: names[i] ?? '',
      createdAt: new Date(base + i),
    }))
  );

  // A new milestone starts at 0%, so a completed project goes back to active.
  await syncProjectStatus(id);

  return NextResponse.json(milestone, { status: 201 });
}
