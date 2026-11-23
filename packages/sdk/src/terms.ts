import { encodeAbiParameters, keccak256, stringToBytes, toHex, zeroAddress, zeroHash } from "viem";
import type { Address, Hex, JobTerms, SubJobTerms } from "@chainwork/types";
import { TERMS_TYPE_STRING } from "@chainwork/types";
import type { ChainworkConfig } from "./config.js";

export const TERMS_TYPEHASH: Hex = keccak256(stringToBytes(TERMS_TYPE_STRING));

export const descriptionHash = (description: string): Hex => keccak256(stringToBytes(description));

/** 32 random bytes from the platform CSPRNG. */
export function newSalt(): Hex {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}

/**
 * Same value as ChainworkEscrow.termsHash(client, terms):
 * keccak256(abi.encode(TERMS_TYPEHASH, chainId, escrow, client, terms)). JobTerms is all static
 * fields, so abi.encode of the struct is its fields in order.
 */
export function termsHash(cfg: Pick<ChainworkConfig, "chainId" | "escrow">, client: Address, t: JobTerms): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        TERMS_TYPEHASH,
        BigInt(cfg.chainId),
        cfg.escrow,
        client,
        t.provider,
        t.evaluator,
        t.verifier,
        t.hook,
        t.expiredAt,
        t.challengeWindow,
        t.budget,
        t.verifierSpec,
        t.descriptionHash,
        t.salt,
      ],
    ),
  );
}

export interface BuildTermsInput {
  provider: Address;
  evaluator: Address;
  budget: bigint;
  description: string;
  /** Seconds from now until the job expires. */
  expiresIn: number;
  /** 0 = evaluator decides; otherwise 30..600 seconds. */
  challengeWindow?: number;
  verifier?: Address;
  verifierSpec?: Hex;
  hook?: Address;
  salt?: Hex;
  now?: number;
}

export function buildTerms(i: BuildTermsInput): JobTerms {
  const now = i.now ?? Math.floor(Date.now() / 1000);
  return {
    provider: i.provider,
    evaluator: i.evaluator,
    verifier: i.verifier ?? zeroAddress,
    hook: i.hook ?? zeroAddress,
    expiredAt: BigInt(now + i.expiresIn),
    challengeWindow: BigInt(i.challengeWindow ?? 0),
    budget: i.budget,
    verifierSpec: i.verifierSpec ?? zeroHash,
    descriptionHash: descriptionHash(i.description),
    salt: i.salt ?? newSalt(),
  };
}

export interface BuildSubTermsInput {
  provider: Address;
  evaluator: Address;
  budget: bigint;
  /** Absolute unix seconds; must be earlier than the parent's expiredAt. */
  expiredAt: bigint;
  challengeWindow?: number;
  verifier?: Address;
  verifierSpec?: Hex;
}

export function buildSubTerms(i: BuildSubTermsInput): SubJobTerms {
  return {
    provider: i.provider,
    evaluator: i.evaluator,
    verifier: i.verifier ?? zeroAddress,
    expiredAt: i.expiredAt,
    challengeWindow: BigInt(i.challengeWindow ?? 0),
    budget: i.budget,
    verifierSpec: i.verifierSpec ?? zeroHash,
  };
}

/** Viem-ready tuple for the JobTerms struct argument. */
export const termsArg = (t: JobTerms) => ({
  provider: t.provider,
  evaluator: t.evaluator,
  verifier: t.verifier,
  hook: t.hook,
  expiredAt: t.expiredAt,
  challengeWindow: t.challengeWindow,
  budget: t.budget,
  verifierSpec: t.verifierSpec,
  descriptionHash: t.descriptionHash,
  salt: t.salt,
});
