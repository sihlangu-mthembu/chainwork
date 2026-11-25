/**
 * Verification for the x402 `escrow` scheme (docs/X402_ESCROW_SCHEME.md).
 *
 * Read-only: every check here is an eth_call. The last check simulates the actual
 * `fundWithAuthorization` call, so anything the chain would reject (frozen budget guard,
 * exhausted session cap, used nonce, bad ERC-1271 signature, insufficient balance) is caught
 * before the facilitator spends gas.
 */
import {
  getAddress,
  hashTypedData,
  isAddress,
  isHex,
  keccak256,
  recoverTypedDataAddress,
  stringToBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type { EscrowPaymentPayload, EscrowPaymentRequirements, JobTerms } from "@chainwork/types";
import { RECEIVE_WITH_AUTHORIZATION_TYPES } from "@chainwork/types";
import { agentAccountAbi, chainworkEscrowImplAbi, fiatTokenV2_2Abi } from "@chainwork/types/abis";
import { Chainwork, explainError, termsArg, termsHash, type ChainworkConfig } from "@chainwork/sdk";
import { money } from "@chainwork/service-kit";
import type { ServiceConfig } from "@chainwork/service-kit";

export type InvalidCode =
  | "invalid_payload"
  | "invalid_scheme"
  | "invalid_network"
  | "invalid_payment_requirements"
  | "invalid_escrow_recipient"
  | "invalid_escrow_terms"
  | "invalid_escrow_description"
  | "invalid_escrow_window"
  | "invalid_escrow_expired"
  | "invalid_escrow_nonce_used"
  | "invalid_escrow_signature"
  | "invalid_escrow_hook"
  | "invalid_escrow_simulation"
  | "insufficient_funds"
  | "unexpected_verify_error";

export interface VerifyFailure {
  isValid: false;
  invalidReason: string;
  invalidCode: InvalidCode;
  invalidMessage: string;
  payer?: Address;
}

export interface VerifySuccess {
  isValid: true;
  payer: Address;
  description: string;
  terms: JobTerms;
  termsHash: Hex;
  /** Chain time used for the checks; settle uses the same clock semantics. */
  now: number;
}

export type VerifyResult = VerifySuccess | VerifyFailure;

export interface NormalizedPayment {
  payload: EscrowPaymentPayload;
  requirements: EscrowPaymentRequirements;
}

export type Normalized = { ok: true; value: NormalizedPayment } | { ok: false; failure: VerifyFailure };

const failure = (code: InvalidCode, message: string, payer?: Address): VerifyFailure => ({
  isValid: false,
  invalidReason: message,
  invalidCode: code,
  invalidMessage: message,
  ...(payer ? { payer: getAddress(payer) } : {}),
});

// ------------------------------------------------------------------ parsing

const record = (v: unknown, what: string): Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error(`${what} is not an object.`);
  return v as Record<string, unknown>;
};

const text = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new Error(`${what} is not a string.`);
  return v;
};

const address = (v: unknown, what: string): Address => {
  if (typeof v !== "string" || !isAddress(v)) throw new Error(`${what} is not an address.`);
  return getAddress(v);
};

const bytes32 = (v: unknown, what: string): Hex => {
  if (typeof v !== "string" || !isHex(v) || v.length !== 66) throw new Error(`${what} is not a 32-byte hex value.`);
  return v as Hex;
};

const bigint = (v: unknown, what: string): bigint => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  throw new Error(`${what} is not a non-negative integer.`);
};

const parseTerms = (raw: unknown): JobTerms => {
  const t = record(raw, "terms");
  return {
    provider: address(t.provider, "terms.provider"),
    evaluator: address(t.evaluator, "terms.evaluator"),
    verifier: address(t.verifier, "terms.verifier"),
    hook: address(t.hook, "terms.hook"),
    expiredAt: bigint(t.expiredAt, "terms.expiredAt"),
    challengeWindow: bigint(t.challengeWindow, "terms.challengeWindow"),
    budget: bigint(t.budget, "terms.budget"),
    verifierSpec: bytes32(t.verifierSpec, "terms.verifierSpec"),
    descriptionHash: bytes32(t.descriptionHash, "terms.descriptionHash"),
    salt: bytes32(t.salt, "terms.salt"),
  };
};

const parsePayload = (raw: unknown): EscrowPaymentPayload => {
  const p = record(raw, "paymentPayload");
  const body = record(p.payload, "paymentPayload.payload");
  const signature = text(body.signature, "paymentPayload.payload.signature");
  if (!isHex(signature) || signature.length <= 2) throw new Error("paymentPayload.payload.signature is not hex.");
  return {
    x402Version: 2,
    scheme: (typeof p.scheme === "string" ? p.scheme : "escrow") as "escrow",
    network: (typeof p.network === "string" ? p.network : "") as "eip155:44005",
    payload: {
      client: address(body.client, "paymentPayload.payload.client"),
      terms: parseTerms(body.terms),
      description: text(body.description, "paymentPayload.payload.description"),
      validAfter: bigint(body.validAfter, "paymentPayload.payload.validAfter").toString(),
      validBefore: bigint(body.validBefore, "paymentPayload.payload.validBefore").toString(),
      signature: signature as Hex,
    },
  };
};

export const parseRequirements = (raw: unknown): EscrowPaymentRequirements => {
  const r = record(raw, "paymentRequirements");
  const e = record(r.extra, "paymentRequirements.extra");
  return {
    scheme: (typeof r.scheme === "string" ? r.scheme : "") as "escrow",
    network: (typeof r.network === "string" ? r.network : "") as "eip155:44005",
    asset: address(r.asset, "paymentRequirements.asset"),
    amount: bigint(r.amount, "paymentRequirements.amount").toString(),
    payTo: address(r.payTo, "paymentRequirements.payTo"),
    resource: typeof r.resource === "string" ? r.resource : "",
    description: typeof r.description === "string" ? r.description : "",
    maxTimeoutSeconds: Number(bigint(r.maxTimeoutSeconds ?? 600, "paymentRequirements.maxTimeoutSeconds")),
    extra: {
      escrow: address(e.escrow, "paymentRequirements.extra.escrow"),
      provider: address(e.provider, "paymentRequirements.extra.provider"),
      evaluator: address(e.evaluator, "paymentRequirements.extra.evaluator"),
      verifier: address(e.verifier, "paymentRequirements.extra.verifier"),
      verifierSpec: bytes32(e.verifierSpec, "paymentRequirements.extra.verifierSpec"),
      challengeWindow: Number(bigint(e.challengeWindow, "paymentRequirements.extra.challengeWindow")),
      expiredAt: Number(bigint(e.expiredAt, "paymentRequirements.extra.expiredAt")),
      bond: bigint(e.bond ?? 0, "paymentRequirements.extra.bond").toString(),
      creditLimit: bigint(e.creditLimit ?? 0, "paymentRequirements.extra.creditLimit").toString(),
      worstCaseLoss: bigint(e.worstCaseLoss ?? 0, "paymentRequirements.extra.worstCaseLoss").toString(),
      reputationScore: Number(bigint(e.reputationScore ?? 0, "paymentRequirements.extra.reputationScore")),
      salt: bytes32(e.salt, "paymentRequirements.extra.salt"),
      descriptionHash: bytes32(e.descriptionHash, "paymentRequirements.extra.descriptionHash"),
    },
  };
};

/** Requirements for callers that only have a signed payload (`POST /escrow/fund`). */
export function requirementsFromPayload(payload: EscrowPaymentPayload, cfg: ChainworkConfig): EscrowPaymentRequirements {
  const t = payload.payload.terms;
  return {
    scheme: "escrow",
    network: `eip155:${cfg.chainId}` as EscrowPaymentRequirements["network"],
    asset: cfg.token,
    amount: t.budget.toString(),
    payTo: cfg.escrow,
    resource: "chainwork://escrow/fund",
    description: payload.payload.description,
    maxTimeoutSeconds: 600,
    extra: {
      escrow: cfg.escrow,
      provider: t.provider,
      evaluator: t.evaluator,
      verifier: t.verifier,
      verifierSpec: t.verifierSpec,
      challengeWindow: Number(t.challengeWindow),
      expiredAt: Number(t.expiredAt),
      bond: "0",
      creditLimit: "0",
      worstCaseLoss: "0",
      reputationScore: 0,
      salt: t.salt,
      descriptionHash: t.descriptionHash,
    },
  };
}

/**
 * Accept both wire shapes:
 *  - v0.1 (frozen): `{paymentPayload, paymentRequirements}`
 *  - x402 v2:       `{x402Version, paymentPayload, paymentRequirements}` or `paymentPayload.accepted`
 *  - `/escrow/fund`: the payload object itself
 */
export function normalizePayment(body: unknown, cfg: ChainworkConfig): Normalized {
  try {
    const obj = record(body, "request body");
    const envelope = obj.paymentPayload !== undefined;
    const payload = parsePayload(envelope ? obj.paymentPayload : obj);
    const acceptedRaw = envelope
      ? (obj.paymentRequirements ?? (obj.paymentPayload as Record<string, unknown> | undefined)?.accepted)
      : undefined;
    const requirements = acceptedRaw !== undefined ? parseRequirements(acceptedRaw) : requirementsFromPayload(payload, cfg);
    return { ok: true, value: { payload, requirements } };
  } catch (e) {
    return { ok: false, failure: failure("invalid_payload", e instanceof Error ? e.message : String(e)) };
  }
}

// --------------------------------------------------------------- verification

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const sameHex = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const networkMatches = (network: string, cfg: ChainworkConfig): boolean => {
  if (network === `eip155:${cfg.chainId}`) return true;
  // Local anvil runs the same Chainwork deployment shape under the Aevum logical network id,
  // because the frozen types pin EscrowPaymentPayload.network to eip155:44005.
  return cfg.chainId === 31337 && network === "eip155:44005";
};

export interface VerifyContext {
  config: ServiceConfig;
  cw: Chainwork;
}

export async function verifyPayment(input: NormalizedPayment, ctx: VerifyContext): Promise<VerifyResult> {
  const { config, cw } = ctx;
  const { payload, requirements: req } = input;
  const p = payload.payload;
  const t = p.terms;
  const client = p.client;
  const cfg = config.cfg;

  // The pending block is the clock the settlement transaction will be mined with.
  const chainBlock = await cw.publicClient.getBlock({ blockTag: "pending" });
  const now = Number(chainBlock.timestamp);

  // 1. Envelope.
  if (payload.x402Version !== 2) return failure("invalid_payload", "Only x402 version 2 is supported.", client);
  if (payload.scheme !== "escrow" || req.scheme !== "escrow") {
    return failure("invalid_scheme", `Unsupported payment scheme "${payload.scheme || req.scheme}".`, client);
  }
  if (!networkMatches(req.network, cfg)) {
    return failure("invalid_network", `The quote is for ${req.network}, not chain ${cfg.chainId}.`, client);
  }
  if (!sameAddress(req.asset, cfg.token)) {
    return failure("invalid_network", "The quote asks for a token other than tUSD8.", client);
  }

  // 2. Recipient: money may only enter this escrow.
  if (!sameAddress(req.payTo, cfg.escrow) || !sameAddress(req.extra.escrow, cfg.escrow)) {
    return failure(
      "invalid_escrow_recipient",
      "The quote asks to pay an address other than the Chainwork escrow. Refusing.",
      client,
    );
  }

  // 3. Terms inside the signed payload must be exactly the advertised requirements.
  let amount: bigint;
  try {
    amount = BigInt(req.amount);
  } catch {
    return failure("invalid_payment_requirements", "The quote amount isn't a number.", client);
  }
  if (amount <= 0n) return failure("invalid_payment_requirements", "The quote amount must be above zero.", client);
  if (amount !== t.budget) {
    return failure("invalid_escrow_terms", "The signed budget does not match the advertised amount.", client);
  }
  if (
    !sameAddress(t.provider, req.extra.provider) ||
    !sameAddress(t.evaluator, req.extra.evaluator) ||
    !sameAddress(t.verifier, req.extra.verifier) ||
    !sameHex(t.verifierSpec, req.extra.verifierSpec) ||
    t.expiredAt !== BigInt(req.extra.expiredAt) ||
    t.challengeWindow !== BigInt(req.extra.challengeWindow) ||
    !sameHex(t.salt, req.extra.salt)
  ) {
    return failure("invalid_escrow_terms", "The signed terms do not match the quoted terms.", client);
  }

  // 4. Description binding.
  const descriptionHash = keccak256(stringToBytes(p.description));
  if (!sameHex(descriptionHash, t.descriptionHash) || !sameHex(descriptionHash, req.extra.descriptionHash)) {
    return failure("invalid_escrow_description", "The signature is for a different task description.", client);
  }
  if (req.description && req.description !== p.description) {
    return failure("invalid_escrow_description", "The quote's description differs from the signed description.", client);
  }

  // 5. Windows and expiry.
  const window = Number(t.challengeWindow);
  if (window !== 0 && (window < 30 || window > 600)) {
    return failure("invalid_escrow_window", "The challenge window must be 0 (evaluator decides) or 30–600 seconds.", client);
  }
  if (t.expiredAt <= BigInt(now + window + 60)) {
    return failure("invalid_escrow_expired", "The job's deadline is too soon to finish and verify the work.", client);
  }
  const validAfter = BigInt(p.validAfter);
  const validBefore = BigInt(p.validBefore);
  if (validBefore <= BigInt(now)) {
    return failure("invalid_escrow_expired", "The payment signature has expired; sign again.", client);
  }
  if (validAfter > BigInt(now)) {
    return failure("invalid_escrow_expired", "The payment signature isn't valid yet.", client);
  }
  if (validBefore - BigInt(now) > BigInt(req.maxTimeoutSeconds)) {
    return failure(
      "invalid_escrow_expired",
      `The signature stays valid longer than the quote allows (${req.maxTimeoutSeconds}s).`,
      client,
    );
  }

  // 6. The only hooks allowed are none or the deployment's BudgetGuard (session-key spending).
  if (t.hook !== zeroAddress && (!cfg.budgetGuard || !sameAddress(t.hook, cfg.budgetGuard))) {
    return failure("invalid_escrow_hook", "The job names a budget guard this deployment does not use.", client);
  }

  // 7. The signature must be over the nonce the escrow will compute.
  let onchainHash: Hex;
  let localHash: Hex;
  try {
    [onchainHash, localHash] = await Promise.all([
      cw.termsHashOnChain(client, t),
      Promise.resolve(termsHash(cfg, client, t)),
    ]);
  } catch (e) {
    return failure("invalid_escrow_terms", explainError(e).message, client);
  }
  if (!sameHex(onchainHash, localHash)) {
    return failure("invalid_escrow_terms", "This deployment computes different terms; check the escrow address.", client);
  }

  // 8. Nonce must be unused.
  const used = await cw.publicClient.readContract({
    address: cfg.token,
    abi: fiatTokenV2_2Abi,
    functionName: "authorizationState",
    args: [client, onchainHash],
  });
  if (used) {
    return failure("invalid_escrow_nonce_used", "This payment signature was already used (each job's signature works once).", client);
  }

  // 9. Signature: EOA (65 bytes) or ERC-1271 (AgentAccount session auth). Checked before the
  //    balance, so an unauthorized payment is refused as unauthorized, whatever the balance.
  const signature = p.signature;
  const message = {
    from: client,
    to: cfg.escrow,
    value: t.budget,
    validAfter,
    validBefore,
    nonce: onchainHash,
  } as const;
  if (signature.length === 132) {
    try {
      const signer = await recoverTypedDataAddress({
        domain: cfg.tokenDomain,
        types: RECEIVE_WITH_AUTHORIZATION_TYPES,
        primaryType: "ReceiveWithAuthorization",
        message,
        signature,
      });
      if (!sameAddress(signer, client)) {
        return failure("invalid_escrow_signature", "The signature does not match this client and these job terms.", client);
      }
    } catch {
      return failure("invalid_escrow_signature", "The payment signature is malformed.", client);
    }
  } else {
    const code = await cw.publicClient.getCode({ address: client });
    if (!code || code === "0x") {
      return failure(
        "invalid_escrow_signature",
        "The signature is not a 65-byte EOA signature and the client is not a smart contract.",
        client,
      );
    }
    const digest = hashTypedData({
      domain: cfg.tokenDomain,
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message,
    });
    try {
      const magic = await cw.publicClient.readContract({
        address: client,
        abi: agentAccountAbi,
        functionName: "isValidSignature",
        args: [digest, signature],
      });
      if (magic.toLowerCase() !== "0x1626ba7e") {
        const frozen = await cw.publicClient
          .readContract({ address: client, abi: agentAccountAbi, functionName: "frozen" })
          .catch(() => false);
        return failure(
          "invalid_escrow_signature",
          frozen
            ? "The smart account is frozen by its owner (kill switch): it signs nothing until unfrozen."
            : "The smart account rejected this signature: the session key is not allowed to fund these exact terms.",
          client,
        );
      }
    } catch (e) {
      return failure("invalid_escrow_signature", explainError(e).message, client);
    }
  }

  // 10. Client balance.
  const balance = await cw.publicClient.readContract({
    address: cfg.token,
    abi: fiatTokenV2_2Abi,
    functionName: "balanceOf",
    args: [client],
  });
  if (balance < t.budget) {
    return failure("insufficient_funds", `The client has ${money(balance)}, needs ${money(t.budget)}.`, client);
  }

  // 11. Simulate the real call: catches frozen guard, session caps, credit and every other revert.
  try {
    await cw.publicClient.simulateContract({
      address: cfg.escrow,
      abi: chainworkEscrowImplAbi,
      functionName: "fundWithAuthorization",
      args: [client, termsArg(t), p.description, validAfter, validBefore, signature],
      account: config.relayer,
    });
  } catch (e) {
    const err = explainError(e);
    const code: InvalidCode = /already used|already been used/i.test(err.message)
      ? "invalid_escrow_nonce_used"
      : "invalid_escrow_simulation";
    return failure(code, err.message, client);
  }

  return { isValid: true, payer: client, description: p.description, terms: t, termsHash: onchainHash, now };
}
