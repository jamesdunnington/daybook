const { drizzle } = require('drizzle-orm/postgres-js');
const { migrate } = require('drizzle-orm/postgres-js/migrator');
const { readMigrationFiles } = require('drizzle-orm/migrator');
const postgres = require('postgres');
const path = require('path');

const migrationsFolder = path.join(__dirname, '..', 'drizzle');

async function main() {
  console.log('[migrate] Starting database migrations...');
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  const db = drizzle(sql);

  try {
    await migrate(db, { migrationsFolder });
    console.log('[migrate] Migrations complete.');
  } catch (err) {
    const pgCode = err?.cause?.code;
    // 42701 = column already exists, 42P07 = relation already exists, 42710 = index already exists
    if (pgCode === '42701' || pgCode === '42P07' || pgCode === '42710') {
      console.warn('[migrate] Schema already partially applied outside Drizzle — recording migrations...');
      const migrations = readMigrationFiles({ migrationsFolder });
      for (const migration of migrations) {
        const existing = await sql`
          SELECT id FROM "__drizzle_migrations" WHERE hash = ${migration.hash} LIMIT 1
        `;
        if (existing.length === 0) {
          await sql`
            INSERT INTO "__drizzle_migrations" (hash, created_at)
            VALUES (${migration.hash}, ${migration.folderMillis})
          `;
          console.log(`[migrate] Recorded migration (hash ${migration.hash.slice(0, 8)}…)`);
        }
      }
      console.log('[migrate] Migrations complete (recovered).');
    } else {
      await sql.end();
      throw err;
    }
  }

  await sql.end();
}

main().catch((err) => {
  console.error('[migrate] Migration failed:', err);
  process.exit(1);
});
