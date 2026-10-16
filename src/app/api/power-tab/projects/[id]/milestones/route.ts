import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { projects, projectMilestones, projectActivityLog } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { computeMilestoneForecast } from '@/lib/power-tab/forecast';
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

  const withForecast = await Promise.all(
    milestones.map(async (m) => {
      const entries = await db
        .select({ countValue: projectActivityLog.countValue, entryDate: projectActivityLog.entryDate })
        .from(projectActivityLog)
        .where(eq(projectActivityLog.milestoneId, m.id));

      const progressSoFar = entries.reduce((sum, e) => sum + parseFloat(e.countValue), 0);
      const forecast = computeMilestoneForecast({
        targetCount: parseFloat(m.targetCount),
        progressSoFar,
        entries: entries.map((e) => ({ countValue: parseFloat(e.countValue), entryDate: e.entryDate })),
      });

      return { ...m, forecast };
    })
  );

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

  const [milestone] = await db
    .insert(projectMilestones)
    .values({
      projectId: id,
      userId,
      title: body.title,
      unitLabel: body.unitLabel ?? 'items',
      targetCount: String(body.targetCount),
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
    })
    .returning();

  return NextResponse.json(milestone, { status: 201 });
}
