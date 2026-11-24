/**
 * Settlement: verify, then call `fundWithAuthorization` once per terms hash.
 *
 * Idempotency is keyed by the terms hash (which is also the EIP-3009 nonce). A repeated /settle
 * returns the first job instead of failing, across process restarts because the mapping is in SQLite.
 * Writes are serialised so two concurrent clients cannot collide on the relayer nonce.
 */
import { decodeEventLog, type Address, type Hash, type TransactionReceipt } from "viem";
import type { EscrowSettleResponse, Job, JobExt } from "@chainwork/types";
import { chainworkEscrowImplAbi, fiatTokenV2_2Abi } from "@chainwork/types/abis";
import { explainError, termsArg, termsHash, type Chainwork } from "@chainwork/sdk";
import { openDb, type Db, type Logger } from "@chainwork/service-kit";
import type { ServiceConfig } from "@chainwork/service-kit";
import { verifyPayment, type NormalizedPayment, type VerifyFailure } from "./verify.js";

export interface SettleResponse extends Omit<EscrowSettleResponse, "network"> {
  network: "eip155:44005";
  /** x402 v2 spelling of `txHash`. */
  transaction?: Hash;
  errorMessage?: string;
  payer?: Address;
  alreadySettled?: boolean;
  pending?: boolean;
}

interface Row {
  terms_hash: string;
  client: string;
  job_id: string | null;
  tx_hash: string | null;
  status: "pending" | "settled";
  created_at: number;
}

export class SettlementStore {
  constructor(readonly db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settlements (
        terms_hash TEXT PRIMARY KEY,
        client TEXT NOT NULL,
        job_id TEXT,
        tx_hash TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS settlements_client ON settlements(client);
    `);
  }

  static open(path: string): SettlementStore {
    return new SettlementStore(openDb(path));
  }

  get(termsHash: string): Row | undefined {
    return this.db.prepare("SELECT * FROM settlements WHERE terms_hash = ?").get(termsHash) as Row | undefined;
  }

  begin(termsHash: string, client: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO settlements (terms_hash, client, status, created_at) VALUES (?, ?, 'pending', ?)")
      .run(termsHash, client, Math.floor(Date.now() / 1000));
  }

  setTxHash(termsHash: string, txHash: string): void {
    this.db.prepare("UPDATE settlements SET tx_hash = ? WHERE terms_hash = ?").run(txHash, termsHash);
  }

  finish(termsHash: string, jobId: string, txHash: string): void {
    this.db
      .prepare("UPDATE settlements SET job_id = ?, tx_hash = ?, status = 'settled' WHERE terms_hash = ?")
      .run(jobId, txHash, termsHash);
  }

  remove(termsHash: string): void {
    this.db.prepare("DELETE FROM settlements WHERE terms_hash = ?").run(termsHash);
  }

  close(): void {
    this.db.close();
  }
}

const network = (cfg: { chainId: number }): "eip155:44005" =>
  `eip155:${cfg.chainId}` as "eip155:44005";

const jobIdFrom = (receipt: TransactionReceipt): bigint | undefined => {
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: chainworkEscrowImplAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "JobCreated") return (ev.args as { jobId: bigint }).jobId;
    } catch {
      /* not a Chainwork event */
    }
  }
  return undefined;
};

const alreadyUsed = (message: string): boolean =>
  /already used|already been used|authorization is used or canceled/i.test(message);

export interface SettlerDeps {
  config: ServiceConfig;
  cw: Chainwork;
  store: SettlementStore;
  logger?: Logger;
}

export class Settler {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: SettlerDeps) {}

  /** Serialise settlement writes: one relayer transaction at a time. */
  settle(input: NormalizedPayment): Promise<SettleResponse> {
    const run = () => this.run(input);
    const next = this.tail.then(run, run);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private success(jobId: string, txHash: Hash | string, extra: Partial<SettleResponse> = {}): SettleResponse {
    return {
      success: true,
      jobId,
      txHash: txHash as Hash,
      transaction: txHash as Hash,
      network: network(this.deps.config.cfg),
      ...extra,
    };
  }

  private failed(reason: string, message?: string, payer?: Address): SettleResponse {
    return {
      success: false,
      network: network(this.deps.config.cfg),
      errorReason: reason,
      errorMessage: message ?? reason,
      ...(payer ? { payer } : {}),
    };
  }

  private async run(input: NormalizedPayment): Promise<SettleResponse> {
    const { config, cw, store, logger } = this.deps;
    const client = input.payload.payload.client;
    const terms = input.payload.payload.terms;

    // Idempotency key: the terms hash, which is also the EIP-3009 nonce. A replay of a request we
    // already settled returns the first job before verification (the nonce is used by definition).
    const key = termsHash(config.cfg, client, terms);
    const existing = store.get(key);
    if (existing?.status === "settled" && existing.job_id) {
      logger?.info("settle.idempotent", { termsHash: key, jobId: existing.job_id, txHash: existing.tx_hash });
      return this.success(existing.job_id, existing.tx_hash ?? "", { alreadySettled: true });
    }
    if (existing?.status === "pending" && existing.tx_hash) {
      // We broadcast but crashed before recording the receipt: reconcile chain state first.
      const receipt = await cw.publicClient
        .getTransactionReceipt({ hash: existing.tx_hash as Hash })
        .catch(() => undefined);
      if (receipt?.status === "success") {
        const jobId = jobIdFrom(receipt);
        if (jobId !== undefined) {
          store.finish(key, jobId.toString(), existing.tx_hash);
          return this.success(jobId.toString(), existing.tx_hash, { alreadySettled: true });
        }
      }
      if (receipt) {
        store.remove(key);
        logger?.warn("settle.reconcile-reverted", { termsHash: key, txHash: existing.tx_hash });
      } else {
        return this.failed("settlement_pending", "The settlement transaction is still waiting for a receipt.", client);
      }
    }
    if (existing?.status === "pending" && !existing.tx_hash) {
      // A crash between begin() and broadcast. Safe to retry.
      store.remove(key);
    }

    const verify = await verifyPayment(input, { config, cw });
    if (!verify.isValid) {
      const f = verify as VerifyFailure;
      if (f.invalidCode === "invalid_escrow_nonce_used") {
        // Funded outside this facilitator (direct call): recover the job and remember it.
        const jobId = await this.findJobId(client, input.payload.payload.description, terms);
        if (jobId !== undefined) {
          store.begin(key, client);
          store.finish(key, jobId.toString(), "");
          return this.success(jobId.toString(), "", { alreadySettled: true });
        }
      }
      return this.failed(f.invalidCode, f.invalidReason, f.payer);
    }

    // A direct funding transaction (not through us) may have used the same nonce between verify and write.
    const used = await cw.publicClient.readContract({
      address: config.cfg.token,
      abi: fiatTokenV2_2Abi,
      functionName: "authorizationState",
      args: [client, verify.termsHash],
    });
    if (used) {
      const jobId = await this.findJobId(client, verify.description, verify.terms);
      if (jobId !== undefined) {
        store.begin(verify.termsHash, client);
        store.finish(verify.termsHash, jobId.toString(), "");
        return this.success(jobId.toString(), "", { alreadySettled: true });
      }
      return this.failed("invalid_escrow_nonce_used", "This payment signature was already used.", client);
    }

    store.begin(verify.termsHash, client);
    const { request } = await cw.publicClient.simulateContract({
      address: config.cfg.escrow,
      abi: chainworkEscrowImplAbi,
      functionName: "fundWithAuthorization",
      args: [
        client,
        termsArg(verify.terms),
        verify.description,
        BigInt(input.payload.payload.validAfter),
        BigInt(input.payload.payload.validBefore),
        input.payload.payload.signature,
      ],
      account: config.relayer,
    });

    let txHash: Hash;
    try {
      txHash = await config.wallet.writeContract(request);
      store.setTxHash(verify.termsHash, txHash);
      logger?.info("settle.broadcast", { termsHash: verify.termsHash, txHash, explorer: config.explorerTx(txHash) });
    } catch (e) {
      const err = explainError(e);
      if (alreadyUsed(err.message)) {
        store.remove(verify.termsHash);
        const jobId = await this.findJobId(client, verify.description, verify.terms);
        if (jobId !== undefined) {
          store.begin(verify.termsHash, client);
          store.finish(verify.termsHash, jobId.toString(), "");
          return this.success(jobId.toString(), "", { alreadySettled: true });
        }
        return this.failed("invalid_escrow_nonce_used", err.message, client);
      }
      store.remove(verify.termsHash);
      logger?.error("settle.failed", { termsHash: verify.termsHash, error: err.message });
      return this.failed("unexpected_settle_error", err.message, client);
    }

    let receipt: TransactionReceipt;
    try {
      receipt = await cw.publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 60_000 });
    } catch {
      // The transaction is broadcast; never rebroadcast, report pending so the caller reconciles.
      return this.success("", txHash, { pending: true, alreadySettled: false });
    }
    if (receipt.status !== "success") {
      store.remove(verify.termsHash);
      return this.failed("invalid_transaction_state", "The settlement transaction reverted on chain.", client);
    }
    const jobId = jobIdFrom(receipt);
    if (jobId === undefined) {
      store.remove(verify.termsHash);
      return this.failed("unexpected_settle_error", "The transaction succeeded but no job was created.", client);
    }
    store.finish(verify.termsHash, jobId.toString(), txHash);
    logger?.info("settle.done", {
      termsHash: verify.termsHash,
      jobId: jobId.toString(),
      txHash,
      explorer: config.explorerTx(txHash),
    });
    return this.success(jobId.toString(), txHash);
  }

  /**
   * Recover the job id for a nonce that was used outside this facilitator. Job ids are sequential,
   * so page through the escrow's read view (never eth_getLogs).
   */
  private async findJobId(client: Address, description: string, terms: NormalizedPayment["payload"]["payload"]["terms"]): Promise<bigint | undefined> {
    const { cw, config } = this.deps;
    let cursor = 1n;
    for (let page = 0; page < 100; page++) {
      const [jobs, , next] = (await cw.publicClient.readContract({
        address: config.cfg.escrow,
        abi: chainworkEscrowImplAbi,
        functionName: "getJobsPage",
        args: [cursor, 100n],
      })) as unknown as [Job[], JobExt[], bigint];
      for (const job of jobs) {
        if (
          job.client.toLowerCase() === client.toLowerCase() &&
          job.provider.toLowerCase() === terms.provider.toLowerCase() &&
          job.evaluator.toLowerCase() === terms.evaluator.toLowerCase() &&
          job.budget === terms.budget &&
          job.expiredAt === terms.expiredAt &&
          job.description === description
        ) {
          return job.id;
        }
      }
      if (next === 0n) break;
      cursor = next;
    }
    return undefined;
  }
}
