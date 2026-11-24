import { openDb, type Db } from "@chainwork/service-kit";

export interface WatchRow {
  job_id: string;
  deliverable: string;
  verdict: "ok" | "challenge";
  reason: string;
  tx_hash: string | null;
  checked_at: number;
}

export class WatcherStore {
  constructor(readonly db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS watches (
        job_id TEXT PRIMARY KEY,
        deliverable TEXT NOT NULL,
        verdict TEXT NOT NULL,
        reason TEXT NOT NULL,
        tx_hash TEXT,
        checked_at INTEGER NOT NULL
      );
    `);
  }

  static open(path: string): WatcherStore {
    return new WatcherStore(openDb(path));
  }

  get(jobId: string): WatchRow | undefined {
    return this.db.prepare("SELECT * FROM watches WHERE job_id = ?").get(jobId) as WatchRow | undefined;
  }

  mark(row: Omit<WatchRow, "checked_at">): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO watches (job_id, deliverable, verdict, reason, tx_hash, checked_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(row.job_id, row.deliverable, row.verdict, row.reason, row.tx_hash, Math.floor(Date.now() / 1000));
  }

  close(): void {
    this.db.close();
  }
}
