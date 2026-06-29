// Sets a flag in app_settings so the first user to register is promoted to admin.
// Run once after migrations, before any user registers.
const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(sql);

  // Check if any users exist already
  const rows = await sql`SELECT COUNT(*) as count FROM "user"`;
  const count = parseInt(rows[0].count, 10);

  if (count === 0) {
    // Set flag — the register endpoint checks this and promotes first user
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('first_user_is_admin', 'true', NOW())
      ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()
    `;
    console.log('[seed] First-user-is-admin flag set.');
  } else {
    console.log(`[seed] ${count} user(s) already exist, skipping flag.`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
