import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/server';
import { db } from '@/lib/db';
import { userSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { linkTelegramAccount } from '@/lib/notifications/telegram';

export async function GET() {
  const { session, error } = await requireSession();
  if (error) return error;

  let settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, session!.user.id),
  });

  if (!settings) {
    [settings] = await db
      .insert(userSettings)
      .values({ userId: session!.user.id })
      .returning();
  }

  // Never return the actual API key value — return a masked version
  return NextResponse.json({
    ...settings,
    openrouterApiKey: settings.openrouterApiKey ? '***' + settings.openrouterApiKey.slice(-4) : null,
  });
}

export async function PATCH(req: NextRequest) {
  const { session, error } = await requireSession();
  if (error) return error;

  const body = await req.json();
  const { timezone, currency, preferredModel, emailNotifications, openrouterApiKey, telegramLinkCode } =
    body;

  // Handle Telegram linking
  if (telegramLinkCode) {
    const linked = await linkTelegramAccount(session!.user.id, telegramLinkCode);
    if (!linked) {
      return NextResponse.json({ error: 'Invalid or expired link code' }, { status: 400 });
    }
    return NextResponse.json({ success: true, linked: true });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (timezone !== undefined) updates.timezone = timezone;
  if (currency !== undefined) updates.currency = currency;
  if (preferredModel !== undefined) updates.preferredModel = preferredModel;
  if (emailNotifications !== undefined) updates.emailNotifications = emailNotifications;
  if (openrouterApiKey !== undefined) {
    updates.openrouterApiKey = openrouterApiKey === '' ? null : openrouterApiKey;
  }

  await db
    .insert(userSettings)
    .values({ userId: session!.user.id, ...updates })
    .onConflictDoUpdate({ target: userSettings.userId, set: updates });

  return NextResponse.json({ success: true });
}
