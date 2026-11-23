import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from "viem";
import {
  agentAccountImplAbi,
  budgetGuardHookImplAbi,
  chainworkEscrowImplAbi,
  reputationRegistryImplAbi,
} from "@chainwork/types/abis";
import { formatUnits } from "./config.js";

const STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

const fmt = (v: unknown): string => (typeof v === "bigint" ? `${formatUnits(v)} tUSD8` : String(v));

/** Plain-English text for every custom error a user or agent can hit. */
const MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  NotClient: () => "Only the client who created this job can do that.",
  NotProvider: () => "Only the job's provider can do that.",
  NotEvaluator: () => "Only the job's evaluator can complete or reject it.",
  WrongStatus: (a) => `The job is ${STATUS[Number(a[0])] ?? "in another state"}, so this action isn't allowed now.`,
  BudgetMismatch: (a) => `The job budget is ${fmt(a[1])}, not ${fmt(a[0])}.`,
  AlreadyAccepted: () => "This job has already been accepted.",
  NotAccepted: () => "The provider has to accept the job (and post its bond) first.",
  Expired: () => "The job's deadline has passed.",
  NotExpired: () => "The job hasn't reached its deadline yet, so it can't be refunded.",
  DepthExceeded: () => "Sub-jobs can't be subcontracted further (trees are one level deep).",
  TooManyChildren: () => "This job already has the maximum number of sub-jobs.",
  ChildBudgetTooHigh: (a) => `Only ${fmt(a[1])} of the parent budget is left; ${fmt(a[0])} was requested.`,
  CreditExceeded: (a) =>
    `Subcontracting that much would use ${fmt(a[0])}, but this agent's bond plus earned credit is ${fmt(a[1])}.`,
  ChildDeadlineTooLate: () => "A sub-job must end before its parent job's deadline.",
  ChildrenOpen: (a) => `${String(a[0])} sub-job(s) are still open; settle them first.`,
  WindowOpen: () => "The challenge window is still open; try again when it ends.",
  WindowClosed: () => "The challenge window has closed.",
  NoWindow: () => "This job has no challenge window; its evaluator decides.",
  AlreadyChallenged: () => "This job is already being challenged; the evaluator decides now.",
  VerifierRejected: () => "The on-chain verifier rejected this deliverable.",
  NoVerifier: () => "This job has no on-chain verifier.",
  BadTerms: () => "The job terms are invalid (budget 0, or the description doesn't match its hash).",
  SubmitTooLate: () => "Too late to submit: the challenge window would run past the job's deadline.",
  ZeroAddress: () => "A required address is missing.",
  BadWindow: () => "Challenge windows must be 0 (evaluator decides) or 30–600 seconds.",
  ProviderNotSet: () => "Set a provider before funding the job.",
  NotRoot: () => "That job isn't the root of a tree.",
  ClientFrozen: () => "This client's budget guard is frozen (kill switch on).",
  OverPerJob: (a) => `This job (${fmt(a[0])}) is over the client's per-job cap of ${fmt(a[1])}.`,
  OverPerDay: (a) => `Funding ${fmt(a[1])} would exceed today's cap of ${fmt(a[2])} (already ${fmt(a[0])}).`,
  OnlyEscrow: () => "Only the escrow can call this.",
  NotOwner: () => "Only the account owner can do that.",
  CallFailed: () => "The owner's call failed.",
  OnlyDeployer: () => "Only the deployer can do that.",
  EscrowAlreadySet: () => "The escrow is already wired up.",
  ERC20InsufficientBalance: () => "Not enough tUSD8 in the wallet.",
};

const ABIS = [chainworkEscrowImplAbi, budgetGuardHookImplAbi, agentAccountImplAbi, reputationRegistryImplAbi];

/** Token-level revert strings from FiatToken V2.2, translated. */
const STRING_REASONS: [RegExp, string][] = [
  [/invalid signature/i, "The signature doesn't match these exact job terms, or the session key isn't allowed to sign them."],
  [/authorization is used or canceled/i, "This payment signature was already used (each job's signature works once)."],
  [/authorization is expired/i, "The payment signature has expired; sign again."],
  [/authorization is not yet valid/i, "The payment signature isn't valid yet."],
  [/caller must be the payee/i, "Only the escrow can redeem this signature."],
  [/transfer amount exceeds balance/i, "Not enough tUSD8 in the wallet."],
  [/transfer amount exceeds allowance/i, "The escrow isn't approved to take this bond; include a permit signature."],
  [/permit is expired/i, "The permit signature has expired; sign again."],
  [/account is blacklisted/i, "This address is blocked by the token."],
];

export class ChainworkError extends Error {
  constructor(
    message: string,
    readonly errorName: string | undefined,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ChainworkError";
  }
}

/** Turn any viem error from a Chainwork call into a ChainworkError with a plain-English message. */
export function explainError(err: unknown): ChainworkError {
  if (err instanceof ChainworkError) return err;
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && MESSAGES[name]) return new ChainworkError(MESSAGES[name](revert.data?.args ?? []), name, err);
      const reason = revert.reason ?? "";
      for (const [re, msg] of STRING_REASONS) if (re.test(reason)) return new ChainworkError(msg, undefined, err);
      const raw = (revert as unknown as { raw?: Hex }).raw;
      if (raw) {
        const decoded = decodeRaw(raw);
        if (decoded) return decoded;
      }
      if (reason) return new ChainworkError(`The transaction was rejected: ${reason}`, undefined, err);
    }
    for (const [re, msg] of STRING_REASONS) if (re.test(err.message)) return new ChainworkError(msg, undefined, err);
    return new ChainworkError(err.shortMessage || err.message, undefined, err);
  }
  return new ChainworkError(err instanceof Error ? err.message : String(err), undefined, err);
}

/** Decode raw revert data against every Chainwork ABI. */
export function decodeRaw(data: Hex): ChainworkError | undefined {
  for (const abi of ABIS) {
    try {
      const d = decodeErrorResult({ abi, data });
      const fn = MESSAGES[d.errorName];
      return new ChainworkError(fn ? fn(d.args ?? []) : d.errorName, d.errorName);
    } catch {
      /* try the next ABI */
    }
  }
  return undefined;
}

export const knownErrorNames = (): string[] => Object.keys(MESSAGES);
