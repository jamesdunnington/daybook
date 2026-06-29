import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// In production (standalone Docker) use a single connection for migrations,
// and a pooled connection for the app.
const sql = postgres(connectionString, {
  max: process.env.NODE_ENV === 'production' ? 10 : 1,
  idle_timeout: 20,
  max_lifetime: 1800,
});

export const db = drizzle(sql, { schema });
export type DB = typeof db;
