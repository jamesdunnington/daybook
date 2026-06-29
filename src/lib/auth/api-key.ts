import { db } from '@/lib/db';
import { apiKeys, user } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

function hashKey(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export interface ApiKeySession {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  keyId: string;
  scopes: string[];
}

export async function validateApiKey(
  authHeader: string | null
): Promise<ApiKeySession | null> {
  if (!authHeader?.startsWith('Bearer dk_')) return null;

  const token = authHeader.slice('Bearer '.length);
  // Format: dk_<prefix8>_<secret>
  const parts = token.split('_');
  if (parts.length < 3) return null;

  const prefix = parts[1];
  const hash = hashKey(token);

  const rows = await db
    .select({
      key: apiKeys,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        banned: user.banned,
      },
    })
    .from(apiKeys)
    .innerJoin(user, eq(apiKeys.userId, user.id))
    .where(eq(apiKeys.keyPrefix, prefix))
    .limit(1);

  if (!rows.length) return null;

  const { key, user: u } = rows[0];
  if (key.keyHash !== hash) return null;
  if (u.banned) return null;
  if (key.expiresAt && key.expiresAt < new Date()) return null;

  // Update last used (fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(() => {});

  return {
    userId: u.id,
    userName: u.name,
    userEmail: u.email,
    userRole: u.role,
    keyId: key.id,
    scopes: key.scopes ?? [],
  };
}

export function generateApiKey(): { token: string; prefix: string; hash: string } {
  const secret = crypto.randomBytes(32).toString('hex');
  const prefix = secret.slice(0, 8);
  const token = `dk_${prefix}_${secret}`;
  const hash = hashKey(token);
  return { token, prefix, hash };
}
