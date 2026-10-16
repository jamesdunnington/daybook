import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { getModelCatalog } from '@/lib/ai/models';

export async function GET() {
  const hdrs = await headers();
  const apiKeySession = await validateApiKey(hdrs.get('authorization'));
  const userId = apiKeySession?.userId ?? (await requireSession()).session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const models = await getModelCatalog();
    return NextResponse.json(models);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
