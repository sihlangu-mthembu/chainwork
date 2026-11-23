import {
  decodeEventLog,
  type Hash,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import type { Address, EscrowPaymentPayload, EscrowSettleResponse, Hex, Job, JobExt, SubJobTerms } from "@chainwork/types";
import { JobStatus } from "@chainwork/types";
import { chainworkEscrowImplAbi, reputationRegistryAbi } from "@chainwork/types/abis";
import type { ChainworkConfig } from "./config.js";
import { ChainworkError, explainError } from "./errors.js";
import { signPermit, type FundingSignature } from "./sign.js";
import { termsArg } from "./terms.js";

export interface TxResult {
  hash: Hash;
  receipt: TransactionReceipt;
}

export interface ProviderQuoteNumbers {
  score: bigint;
  bondBps: bigint;
  bond: bigint;
  creditLimit: bigint;
  /** What the client can lose at worst if this provider fails after subcontracting: bond + credit, capped at budget. */
  worstCaseLoss: bigint;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry transient RPC failures (network, rate limit) with exponential backoff; never retries reverts. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 400): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /fetch failed|timeout|timed out|ECONNRESET|429|rate limit|503|502|socket/i.test(msg);
      if (!transient) throw e;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}

/**
 * High-level client for one Chainwork deployment. Every write simulates first, so a revert is
 * reported in plain English before any gas is spent.
 */
export class Chainwork {
  constructor(
    readonly cfg: ChainworkConfig,
    readonly publicClient: PublicClient,
    /** Signs and pays gas for this agent's transactions. */
    readonly walletClient?: WalletClient,
  ) {}

  private get sender(): LocalAccount {
    const a = this.walletClient?.account;
    if (!a || a.type !== "local") throw new ChainworkError("This client has no local signing account.", undefined);
    return a as LocalAccount;
  }

  private async write(functionName: string, args: readonly unknown[]): Promise<TxResult> {
    if (!this.walletClient) throw new ChainworkError("A wallet client is needed to send transactions.", undefined);
    try {
      const { request } = await withRetry(() =>
        this.publicClient.simulateContract({
          address: this.cfg.escrow,
          abi: chainworkEscrowImplAbi,
          functionName: functionName as never,
          args: args as never,
          account: this.sender,
        }),
      );
      const hash = await this.walletClient.writeContract(request as never);
      const receipt = await withRetry(() => this.publicClient.waitForTransactionReceipt({ hash }));
      if (receipt.status !== "success") throw new ChainworkError("The transaction was mined but reverted.", undefined);
      return { hash, receipt };
    } catch (e) {
      throw explainError(e);
    }
  }

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return withRetry(
      () =>
        this.publicClient.readContract({
          address: this.cfg.escrow,
          abi: chainworkEscrowImplAbi,
          functionName: functionName as never,
          args: args as never,
        }) as Promise<T>,
    );
  }

  private jobIdFrom(receipt: TransactionReceipt, eventName: "JobCreated" | "SubJobCreated"): bigint {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.cfg.escrow.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: chainworkEscrowImplAbi, data: log.data, topics: log.topics });
        if (ev.eventName === eventName) {
          const a = ev.args as { jobId?: bigint; childId?: bigint };
          return eventName === "SubJobCreated" ? (a.childId as bigint) : (a.jobId as bigint);
        }
      } catch {
        /* not ours */
      }
    }
    throw new ChainworkError(`No ${eventName} event in the receipt.`, undefined);
  }

  // ------------------------------------------------------------- reads

  getJob = (id: bigint) => this.read<Job>("getJob", [id]);
  getJobExt = (id: bigint) => this.read<JobExt>("getJobExt", [id]);
  getChildren = (id: bigint) => this.read<readonly bigint[]>("getChildren", [id]);
  jobCount = () => this.read<bigint>("jobCount");
  maxSubcontract = (id: bigint) => this.read<bigint>("maxSubcontract", [id]);
  childrenRoot = (id: bigint) => this.read<Hex>("childrenRoot", [id]);
  challengeBondFor = (budget: bigint) => this.read<bigint>("challengeBondFor", [budget]);
  termsHashOnChain = (client: Address, terms: FundingSignature["terms"]) =>
    this.read<Hex>("termsHash", [client, termsArg(terms)]);

  /** Bond, credit and worst-case exposure for hiring `provider` at `budget`. Used to build 402 quotes. */
  async providerNumbers(provider: Address, budget: bigint): Promise<ProviderQuoteNumbers> {
    const r = (fn: "score" | "bondBps" | "creditLimit" | "requiredBond", args: readonly unknown[]) =>
      withRetry(
        () =>
          this.publicClient.readContract({
            address: this.cfg.reputation,
            abi: reputationRegistryAbi,
            functionName: fn,
            args: args as never,
          }) as Promise<bigint>,
      );
    const [score, bondBps, creditLimit, bond] = await Promise.all([
      r("score", [provider]),
      r("bondBps", [provider]),
      r("creditLimit", [provider]),
      r("requiredBond", [provider, budget]),
    ]);
    const worst = bond + creditLimit;
    return { score, bondBps, bond, creditLimit, worstCaseLoss: worst > budget ? budget : worst };
  }

  // ------------------------------------------------------------ writes

  /** Relayer / facilitator path: submit a client's funding signature. Idempotent per terms hash. */
  async fund(sig: FundingSignature, description: string): Promise<TxResult & { jobId: bigint }> {
    const r = await this.write("fundWithAuthorization", [
      sig.client,
      termsArg(sig.terms),
      description,
      sig.validAfter,
      sig.validBefore,
      sig.signature,
    ]);
    return { ...r, jobId: this.jobIdFrom(r.receipt, "JobCreated") };
  }

  /** Hand the signature to an x402 escrow facilitator instead of paying gas yourself. */
  async fundViaFacilitator(sig: FundingSignature, description: string): Promise<EscrowSettleResponse> {
    if (!this.cfg.facilitatorUrl) throw new ChainworkError("No facilitator URL configured.", undefined);
    const payload: EscrowPaymentPayload = {
      x402Version: 2,
      scheme: "escrow",
      network: "eip155:44005",
      payload: {
        client: sig.client,
        terms: sig.terms,
        description,
        validAfter: sig.validAfter.toString(),
        validBefore: sig.validBefore.toString(),
        signature: sig.signature,
      },
    };
    const res = await withRetry(() =>
      fetch(`${this.cfg.facilitatorUrl}/escrow/fund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      }),
    );
    return (await res.json()) as EscrowSettleResponse;
  }

  /** Provider accepts and posts its reputation-priced bond via permit (no approve tx). */
  async accept(jobId: bigint): Promise<TxResult & { bond: bigint }> {
    const job = await this.getJob(jobId);
    const { bond } = await this.providerNumbers(job.provider, job.budget);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const sig = bond > 0n ? await signPermit(this.sender, this.cfg, this.publicClient, bond, deadline) : "0x";
    const r = await this.write("acceptJob", [jobId, deadline, sig]);
    return { ...r, bond };
  }

  async subcontract(parentId: bigint, terms: SubJobTerms, description: string): Promise<TxResult & { childId: bigint }> {
    const r = await this.write("createSubJob", [parentId, terms, description]);
    return { ...r, childId: this.jobIdFrom(r.receipt, "SubJobCreated") };
  }

  submit = (jobId: bigint, deliverable: Hex) => this.write("submit", [jobId, deliverable, "0x"]);
  submitWithProof = (jobId: bigint, deliverable: Hex, proof: Hex) =>
    this.write("submitWithProof", [jobId, deliverable, proof]);
  complete = (jobId: bigint, reason: Hex) => this.write("complete", [jobId, reason, "0x"]);
  reject = (jobId: bigint, reason: Hex) => this.write("reject", [jobId, reason, "0x"]);
  finalize = (jobId: bigint) => this.write("finalize", [jobId]);
  claimRefund = (jobId: bigint) => this.write("claimRefund", [jobId]);
  settleTree = (rootId: bigint) => this.write("settleTree", [rootId]);

  /** Coordinator: submit the parent with the Merkle root of its completed children's deliverables. */
  async submitParent(jobId: bigint): Promise<TxResult & { root: Hex }> {
    const root = await this.childrenRoot(jobId);
    return { ...(await this.submit(jobId, root)), root };
  }

  /** Watcher: dispute a submission inside its window, posting the challenge bond via permit. */
  async challenge(jobId: bigint, reason: Hex): Promise<TxResult> {
    const job = await this.getJob(jobId);
    const bond = await this.challengeBondFor(job.budget);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const sig = bond > 0n ? await signPermit(this.sender, this.cfg, this.publicClient, bond, deadline) : "0x";
    return this.write("challenge", [jobId, reason, deadline, sig]);
  }

  /** Seconds left in a job's challenge window (0 if closed or none). */
  async windowRemaining(jobId: bigint, nowSec?: number): Promise<number> {
    const [job, ext] = await Promise.all([this.getJob(jobId), this.getJobExt(jobId)]);
    if (job.status !== JobStatus.Submitted || ext.challengeWindow === 0n) return 0;
    const now = BigInt(nowSec ?? Math.floor(Date.now() / 1000));
    const end = ext.submittedAt + ext.challengeWindow;
    return end > now ? Number(end - now) : 0;
  }
}
