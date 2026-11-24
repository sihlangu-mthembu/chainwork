import { openDb, type Db } from "@chainwork/service-kit";

export interface EvaluationRow {
  job_id: string;
  decision: "complete" | "reject";
  reason: string;
  tx_hash: string;
  created_at: number;
}

export class EvaluatorStore {
  constructor(readonly db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS evaluations (
        job_id TEXT PRIMARY KEY,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  static open(path: string): EvaluatorStore {
    return new EvaluatorStore(openDb(path));
  }

  get(jobId: string): EvaluationRow | undefined {
    return this.db.prepare("SELECT * FROM evaluations WHERE job_id = ?").get(jobId) as EvaluationRow | undefined;
  }

  put(row: Omit<EvaluationRow, "created_at">): void {
    this.db
      .prepare("INSERT OR REPLACE INTO evaluations (job_id, decision, reason, tx_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.job_id, row.decision, row.reason, row.tx_hash, Math.floor(Date.now() / 1000));
  }

  close(): void {
    this.db.close();
  }
}
