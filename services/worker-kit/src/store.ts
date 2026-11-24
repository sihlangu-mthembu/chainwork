/** Worker state: delivered outputs and job status. Survives a restart. */
import { openDb, type Db } from "@chainwork/service-kit";

export interface StoredOutput {
  jobId: string;
  body: string;
  hash: string;
  createdAt: number;
}

export interface JobRow {
  jobId: string;
  description: string;
  status: "accepted" | "working" | "submitted" | "error";
  error: string | null;
  updatedAt: number;
}

export class WorkerStore {
  /** After close, writes are dropped and reads miss: a job still finishing during shutdown must not crash the process. */
  private closed = false;

  constructor(readonly db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS outputs (
        job_id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  static open(path: string): WorkerStore {
    return new WorkerStore(openDb(path));
  }

  putOutput(jobId: string, body: string, hash: string): void {
    if (this.closed) return;
    this.db
      .prepare("INSERT OR REPLACE INTO outputs (job_id, body, hash, created_at) VALUES (?, ?, ?, ?)")
      .run(jobId, body, hash, Math.floor(Date.now() / 1000));
  }

  output(jobId: string): StoredOutput | undefined {
    if (this.closed) return undefined;
    return this.db.prepare("SELECT * FROM outputs WHERE job_id = ?").get(jobId) as StoredOutput | undefined;
  }

  setJob(jobId: string, description: string, status: JobRow["status"], error?: string): void {
    if (this.closed) return;
    this.db
      .prepare("INSERT OR REPLACE INTO jobs (job_id, description, status, error, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(jobId, description, status, error ?? null, Math.floor(Date.now() / 1000));
  }

  job(jobId: string): JobRow | undefined {
    if (this.closed) return undefined;
    return this.db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId) as JobRow | undefined;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
