import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { calendarEvents } from '@/lib/db/schema';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { and, eq, gte, lte, ilike, or } from 'drizzle-orm';
import { RRule } from 'rrule';

export async function GET(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const search = searchParams.get('search')?.trim();
  const all = searchParams.get('all') === 'true';
  const unscoped = !!search || all;

  const conditions = [eq(calendarEvents.userId, userId)];
  // A text search or an explicit "all" view looks across all time (and skips recurrence
  // expansion below); otherwise scope to the given date range.
  if (!unscoped) {
    if (startParam) conditions.push(gte(calendarEvents.startAt, new Date(startParam)));
    if (endParam) conditions.push(lte(calendarEvents.startAt, new Date(endParam)));
  } else if (search) {
    conditions.push(
      or(ilike(calendarEvents.title, `%${search}%`), ilike(calendarEvents.description, `%${search}%`))!
    );
  }

  const rows = await db
    .select()
    .from(calendarEvents)
    .where(and(...conditions));

  if (unscoped) {
    // Skip recurrence expansion — return each matching event once, at its own base start/end time.
    return NextResponse.json(rows.map((event) => ({ ...event, instanceDate: event.startAt.toISOString() })));
  }

  const rangeStart = startParam ? new Date(startParam) : new Date(0);
  const rangeEnd = endParam ? new Date(endParam) : new Date(8640000000000000);

  // Expand recurring events
  const expanded: Array<typeof rows[number] & { instanceDate: string }> = [];

  for (const event of rows) {
    if (event.rrule) {
      try {
        const rule = RRule.fromString(event.rrule);
        const occurrences = rule.between(rangeStart, rangeEnd, true);
        const durationMs =
          new Date(event.endAt).getTime() - new Date(event.startAt).getTime();

        for (const occ of occurrences) {
          expanded.push({
            ...event,
            startAt: occ,
            endAt: new Date(occ.getTime() + durationMs),
            instanceDate: occ.toISOString(),
          });
        }
      } catch {
        // If rrule parsing fails, fall back to the base event
        expanded.push({ ...event, instanceDate: event.startAt.toISOString() });
      }
    } else {
      expanded.push({ ...event, instanceDate: event.startAt.toISOString() });
    }
  }

  return NextResponse.json(expanded);
}

export async function POST(req: NextRequest) {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { title, description, location, startAt, endAt, allDay, color, rrule } = body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }
  if (!startAt || !endAt) {
    return NextResponse.json(
      { error: 'startAt and endAt are required' },
      { status: 400 }
    );
  }

  const [event] = await db
    .insert(calendarEvents)
    .values({
      userId,
      title: title.trim(),
      description: description ?? null,
      location: location ?? null,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      allDay: allDay ?? false,
      color: color ?? '#6366f1',
      rrule: rrule ?? null,
    })
    .returning();

  return NextResponse.json(event, { status: 201 });
}
