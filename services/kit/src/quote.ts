/**
 * Build the 402 quote the escrow scheme defines (docs/X402_ESCROW_SCHEME.md).
 * Bond and credit come from chain reads at quote time, so a client can see its worst-case loss.
 */
import { getAddress, zeroAddress, zeroHash } from "viem";
import type { Address, EscrowPaymentPayload, EscrowPaymentRequirements, Hex, JobTerms } from "@chainwork/types";
import {
  Chainwork,
  descriptionHash,
  newSalt,
  type ChainworkConfig,
  type FundingSignature,
  toUnits,
} from "@chainwork/sdk";

export interface QuoteInput {
  provider: Address;
  evaluator: Address;
  budget: bigint;
  description: string;
  /** Absolute URL of the paid resource, e.g. https://agents.local/coordinator/jobs. */
  resource: string;
  /** Seconds from now until the job's deadline; must exceed challengeWindow + 120. */
  expiresIn?: number;
  challengeWindow?: number;
  verifier?: Address;
  verifierSpec?: Hex;
  maxTimeoutSeconds?: number;
  now?: number;
}

export function networkId(cfg: ChainworkConfig): EscrowPaymentRequirements["network"] {
  // The frozen type says eip155:44005; a local chain uses its own id so checkQuote accepts it.
  return `eip155:${cfg.chainId}` as EscrowPaymentRequirements["network"];
}

export async function buildEscrowQuote(
  cw: Chainwork,
  cfg: ChainworkConfig,
  input: QuoteInput,
): Promise<EscrowPaymentRequirements> {
  if (input.budget <= 0n) throw new Error("A quote needs a budget above zero.");
  // Quote against the next block's clock: an idle chain's latest block can be minutes old.
  const now = input.now ?? Number((await cw.publicClient.getBlock({ blockTag: "pending" })).timestamp);
  const challengeWindow = input.challengeWindow ?? 60;
  const expiresIn = input.expiresIn ?? 1800;
  if (challengeWindow !== 0 && (challengeWindow < 30 || challengeWindow > 600)) {
    throw new Error("The challenge window must be 0 or 30–600 seconds.");
  }
  if (now + expiresIn <= now + challengeWindow + 120) {
    throw new Error(`expiresIn=${expiresIn}s is too short for a ${challengeWindow}s challenge window (needs window + 120s).`);
  }
  const numbers = await cw.providerNumbers(input.provider, input.budget);
  const descriptionHashHex = descriptionHash(input.description);
  const salt = newSalt();
  const expiredAt = now + expiresIn;

  return {
    scheme: "escrow",
    network: networkId(cfg),
    asset: cfg.token,
    amount: input.budget.toString(),
    payTo: cfg.escrow,
    resource: input.resource,
    description: input.description,
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? 600,
    extra: {
      escrow: cfg.escrow,
      provider: input.provider,
      evaluator: input.evaluator,
      verifier: input.verifier ?? zeroAddress,
      verifierSpec: input.verifierSpec ?? zeroHash,
      challengeWindow,
      expiredAt,
      bond: numbers.bond.toString(),
      creditLimit: numbers.creditLimit.toString(),
      worstCaseLoss: numbers.worstCaseLoss.toString(),
      reputationScore: Number(numbers.score),
      salt,
      descriptionHash: descriptionHashHex,
    },
  };
}

/** Wrap a client signature in the PAYMENT-SIGNATURE body the spec defines. */
export function payloadFromSignature(
  sig: FundingSignature,
  description: string,
  cfg: ChainworkConfig,
): EscrowPaymentPayload {
  return {
    x402Version: 2,
    scheme: "escrow",
    network: networkId(cfg),
    payload: {
      client: sig.client,
      terms: sig.terms,
      description,
      validAfter: sig.validAfter.toString(),
      validBefore: sig.validBefore.toString(),
      signature: sig.signature,
    },
  };
}

/** Turn a checked quote into the JobTerms a client signs. `hook` is the client's own BudgetGuard. */
export function termsFromQuote(q: EscrowPaymentRequirements, hook: Address = zeroAddress): JobTerms {
  const extra = q.extra;
  return {
    provider: getAddress(extra.provider),
    evaluator: getAddress(extra.evaluator),
    verifier: getAddress(extra.verifier),
    hook,
    expiredAt: BigInt(extra.expiredAt),
    challengeWindow: BigInt(extra.challengeWindow),
    budget: BigInt(q.amount),
    verifierSpec: extra.verifierSpec,
    descriptionHash: extra.descriptionHash,
    salt: extra.salt,
  };
}

/** Human form of a base-unit amount, for invalidReason sentences. */
export const money = (units: bigint): string => {
  const v = units < 0n ? -units : units;
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${units < 0n ? "-" : ""}${whole}${frac ? `.${frac}` : ""} tUSD8`;
};

export { toUnits };
