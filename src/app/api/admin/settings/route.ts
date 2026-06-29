import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/server';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';

const ALLOWED_KEYS = [
  'global_openrouter_api_key',
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'telegram_bot_token',
  'first_user_is_admin',
];

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const settings = await db.query.appSettings.findMany();
  // Mask sensitive values
  const masked = settings.map((s) => ({
    key: s.key,
    value: s.key.includes('key') || s.key.includes('token') || s.key.includes('pass')
      ? s.value ? '***' + s.value.slice(-4) : null
      : s.value,
    updatedAt: s.updatedAt,
  }));
  return NextResponse.json(masked);
}

export async function PATCH(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json() as Record<string, string>;
  const entries = Object.entries(body).filter(([k]) => ALLOWED_KEYS.includes(k));

  if (!entries.length) {
    return NextResponse.json({ error: 'No valid settings provided' }, { status: 400 });
  }

  for (const [key, value] of entries) {
    await db
      .insert(appSettings)
      .values({ key, value: value === '' ? null : value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: value === '' ? null : value, updatedAt: new Date() },
      });
  }

  return NextResponse.json({ success: true });
}
