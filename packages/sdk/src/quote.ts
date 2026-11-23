import { getAddress, isAddressEqual, zeroAddress } from "viem";
import type { EscrowPaymentRequirements, JobTerms } from "@chainwork/types";
import { TUSD8 } from "@chainwork/types";
import type { ChainworkConfig } from "./config.js";
import { formatUnits } from "./config.js";
import { descriptionHash } from "./terms.js";

export interface QuoteLimits {
  /** Refuse quotes above this budget (base units). */
  maxBudget?: bigint;
  /** Refuse quotes whose worst-case loss (bond + credit the provider may subcontract) exceeds this. */
  maxWorstCaseLoss?: bigint;
  /** Only these evaluators are trusted (empty/undefined = any). */
  trustedEvaluators?: string[];
  now?: number;
}

export type QuoteCheck = { ok: true; terms: JobTerms } | { ok: false; reason: string };

/**
 * Check a 402 escrow quote BEFORE signing. This is the client's prompt-injection firewall at the
 * HTTP layer: whatever a worker's response says, money can only go into this escrow, on these terms.
 */
export function checkQuote(
  q: EscrowPaymentRequirements,
  cfg: ChainworkConfig,
  description: string,
  limits: QuoteLimits = {},
): QuoteCheck {
  const now = limits.now ?? Math.floor(Date.now() / 1000);
  const fail = (reason: string): QuoteCheck => ({ ok: false, reason });
  if (q.scheme !== "escrow") return fail(`Unsupported payment scheme "${q.scheme}".`);
  if (q.network !== `eip155:${cfg.chainId}` && !(cfg.chainId === 44005 && q.network === "eip155:44005")) {
    return fail(`The quote is for network ${q.network}, not chain ${cfg.chainId}.`);
  }
  if (!isAddressEqual(q.asset, cfg.token) && !(cfg.chainId === 44005 && isAddressEqual(q.asset, TUSD8.address))) {
    return fail("The quote asks for a token other than tUSD8.");
  }
  if (!isAddressEqual(q.payTo, cfg.escrow) || !isAddressEqual(q.extra.escrow, cfg.escrow)) {
    return fail("The quote asks to pay an address other than the Chainwork escrow. Refusing.");
  }
  let budget: bigint;
  try {
    budget = BigInt(q.amount);
  } catch {
    return fail("The quote amount isn't a number.");
  }
  if (budget <= 0n) return fail("The quote amount must be above zero.");
  if (limits.maxBudget !== undefined && budget > limits.maxBudget) {
    return fail(`The quote (${formatUnits(budget)} tUSD8) is over your limit of ${formatUnits(limits.maxBudget)} tUSD8.`);
  }
  const worst = BigInt(q.extra.worstCaseLoss);
  if (limits.maxWorstCaseLoss !== undefined && worst > limits.maxWorstCaseLoss) {
    return fail(`Worst-case loss ${formatUnits(worst)} tUSD8 is over your limit of ${formatUnits(limits.maxWorstCaseLoss)}.`);
  }
  if (q.extra.provider === zeroAddress || q.extra.evaluator === zeroAddress) return fail("The quote has no provider or evaluator.");
  if (limits.trustedEvaluators?.length && !limits.trustedEvaluators.some((e) => isAddressEqual(getAddress(e), q.extra.evaluator))) {
    return fail("The quote names an evaluator you don't trust.");
  }
  const w = q.extra.challengeWindow;
  if (w !== 0 && (w < 30 || w > 600)) return fail("The challenge window must be 0 or 30–600 seconds.");
  if (q.extra.expiredAt <= now + w + 60) return fail("The quote's deadline is too soon to finish and verify the work.");
  if (q.extra.descriptionHash !== descriptionHash(description)) return fail("The quote is for a different task description.");
  return {
    ok: true,
    terms: {
      provider: getAddress(q.extra.provider),
      evaluator: getAddress(q.extra.evaluator),
      verifier: getAddress(q.extra.verifier),
      hook: zeroAddress,
      expiredAt: BigInt(q.extra.expiredAt),
      challengeWindow: BigInt(w),
      budget,
      verifierSpec: q.extra.verifierSpec,
      descriptionHash: q.extra.descriptionHash,
      salt: q.extra.salt,
    },
  };
}
