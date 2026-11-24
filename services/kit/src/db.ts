/**
 * SQLite helpers. Uses Node's built-in `node:sqlite` (Node >= 22.13) so services need no native
 * addon and the Docker image stays small. Every service owns its own database file.
 *
 * Loaded through createRequire: Vite/Vitest does not yet list `node:sqlite` as a built-in, and a
 * static import would be rewritten into a browser module. The runtime module is still Node's own.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: typeof DatabaseSyncType };

export type Db = DatabaseSyncType;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function closeDb(db: Db): void {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}

/** Run a function in one transaction; rolls back on throw. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const out = fn();
    db.exec("COMMIT;");
    return out;
  } catch (e) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      /* the transaction may already be gone */
    }
    throw e;
  }
}
