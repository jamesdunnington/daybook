// Runs Drizzle migrations programmatically at container start.
// Kept as plain JS so it runs without ts-node in the Docker runner stage.
const { drizzle } = require('drizzle-orm/postgres-js');
const { migrate } = require('drizzle-orm/postgres-js/migrator');
const postgres = require('postgres');
const path = require('path');

async function main() {
  console.log('[migrate] Starting database migrations...');
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  const db = drizzle(sql);
  await migrate(db, {
    migrationsFolder: path.join(__dirname, '..', 'drizzle'),
  });
  await sql.end();
  console.log('[migrate] Migrations complete.');
}

main().catch((err) => {
  console.error('[migrate] Migration failed:', err);
  process.exit(1);
});
