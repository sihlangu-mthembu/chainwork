import { openDb, type Db } from "@chainwork/service-kit";

export interface IndexedEvent {
  id: number;
  block: number;
  tx_hash: string;
  log_index: number;
  address: string;
  event: string;
  job_id: string | null;
  args: string;
}

export interface NewEvent {
  block: number;
  txHash: string;
  logIndex: number;
  address: string;
  event: string;
  jobId: string | null;
  args: string;
}

export class IndexerStore {
  constructor(readonly db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        block INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        address TEXT NOT NULL,
        event TEXT NOT NULL,
        job_id TEXT,
        args TEXT NOT NULL,
        UNIQUE (tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS events_job ON events(job_id);
      CREATE INDEX IF NOT EXISTS events_block ON events(block);
    `);
  }

  static open(path: string): IndexerStore {
    return new IndexerStore(openDb(path));
  }

  cursor(): bigint {
    const row = this.db.prepare("SELECT block FROM cursor WHERE id = 1").get() as { block: number } | undefined;
    return BigInt(row?.block ?? 0);
  }

  setCursor(block: bigint): void {
    this.db
      .prepare("INSERT OR REPLACE INTO cursor (id, block, updated_at) VALUES (1, ?, ?)")
      .run(Number(block), Math.floor(Date.now() / 1000));
  }

  insert(events: NewEvent[]): number {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO events (block, tx_hash, log_index, address, event, job_id, args) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    let inserted = 0;
    for (const e of events) {
      const result = stmt.run(e.block, e.txHash, e.logIndex, e.address.toLowerCase(), e.event, e.jobId, e.args);
      if (result.changes > 0) inserted++;
    }
    return inserted;
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  }

  byJob(jobId: string, limit = 100): IndexedEvent[] {
    return this.db
      .prepare("SELECT * FROM events WHERE job_id = ? ORDER BY block ASC, log_index ASC LIMIT ?")
      .all(jobId, limit) as unknown as IndexedEvent[];
  }

  byAddress(address: string, limit = 100): IndexedEvent[] {
    return this.db
      .prepare("SELECT * FROM events WHERE address = ? ORDER BY block DESC, log_index DESC LIMIT ?")
      .all(address.toLowerCase(), limit) as unknown as IndexedEvent[];
  }

  close(): void {
    this.db.close();
  }
}
