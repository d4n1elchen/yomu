import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

const DB_PATH = process.env.YOMU_DB_PATH ?? './yomu.db';

/**
 * better-sqlite3 is synchronous and holds its own connection, so one instance
 * per process is both sufficient and correct. Next's dev server re-evaluates
 * modules on reload, so the handle is parked on globalThis to avoid leaking a
 * connection (and a WAL lock) on every edit.
 */
const globalForDb = globalThis as unknown as {
  yomuSqlite?: Database.Database;
};

function connect(): Database.Database {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

export const sqlite = (globalForDb.yomuSqlite ??= connect());

export const db = drizzle(sqlite, { schema });

export { schema };
