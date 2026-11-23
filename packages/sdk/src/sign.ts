import { encodeAbiParameters, type LocalAccount, type PublicClient } from "viem";
import type { Address, Hex, JobTerms } from "@chainwork/types";
import { PERMIT_TYPES, RECEIVE_WITH_AUTHORIZATION_TYPES } from "@chainwork/types";
import { fiatTokenV2_2Abi } from "@chainwork/types/abis";
import type { ChainworkConfig } from "./config.js";
import { termsArg, termsHash } from "./terms.js";

export interface FundingSignature {
  client: Address;
  terms: JobTerms;
  validAfter: bigint;
  validBefore: bigint;
  signature: Hex;
}

const domainOf = (cfg: ChainworkConfig) => ({
  name: cfg.tokenDomain.name,
  version: cfg.tokenDomain.version,
  chainId: cfg.tokenDomain.chainId,
  verifyingContract: cfg.tokenDomain.verifyingContract,
});

function receiveMessage(cfg: ChainworkConfig, from: Address, t: JobTerms, validAfter: bigint, validBefore: bigint) {
  return {
    from,
    to: cfg.escrow,
    value: t.budget,
    validAfter,
    validBefore,
    nonce: termsHash(cfg, from, t),
  } as const;
}

/**
 * EOA client: sign tUSD8 ReceiveWithAuthorization to the escrow, nonce = termsHash.
 * Anyone (a facilitator) can submit it, but nobody can change the terms.
 */
export async function signFunding(
  account: LocalAccount,
  cfg: ChainworkConfig,
  terms: JobTerms,
  opts: { validAfter?: bigint; validBefore?: bigint; ttlSeconds?: number } = {},
): Promise<FundingSignature> {
  const validAfter = opts.validAfter ?? 0n;
  const validBefore = opts.validBefore ?? BigInt(Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 600));
  const signature = await account.signTypedData({
    domain: domainOf(cfg),
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: receiveMessage(cfg, account.address, terms, validAfter, validBefore),
  });
  return { client: account.address, terms, validAfter, validBefore, signature };
}

const SESSION_AUTH_PARAMS = [
  {
    type: "tuple",
    components: [
      { name: "key", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      {
        name: "terms",
        type: "tuple",
        components: [
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "verifier", type: "address" },
          { name: "hook", type: "address" },
          { name: "expiredAt", type: "uint64" },
          { name: "challengeWindow", type: "uint64" },
          { name: "budget", type: "uint256" },
          { name: "verifierSpec", type: "bytes32" },
          { name: "descriptionHash", type: "bytes32" },
          { name: "salt", type: "bytes32" },
        ],
      },
      { name: "keySignature", type: "bytes" },
    ],
  },
] as const;

/**
 * AgentAccount client: a session key signs the digest tUSD8 will ask the account about, and the
 * signature is wrapped as abi.encode(SessionAuth) so the account can re-check scope on-chain.
 * Terms must use the account's BudgetGuard as `hook`, or the account rejects them.
 */
export async function signFundingWithSession(
  sessionKey: LocalAccount,
  cfg: ChainworkConfig,
  agentAccount: Address,
  terms: JobTerms,
  opts: { validAfter?: bigint; validBefore?: bigint; ttlSeconds?: number } = {},
): Promise<FundingSignature> {
  const validAfter = opts.validAfter ?? 0n;
  const validBefore = opts.validBefore ?? BigInt(Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 600));
  const keySignature = await sessionKey.signTypedData({
    domain: domainOf(cfg),
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: receiveMessage(cfg, agentAccount, terms, validAfter, validBefore),
  });
  const signature = encodeAbiParameters(SESSION_AUTH_PARAMS, [
    { key: sessionKey.address, value: terms.budget, validAfter, validBefore, terms: termsArg(terms), keySignature },
  ]);
  return { client: agentAccount, terms, validAfter, validBefore, signature };
}

/** EIP-2612 permit for the escrow (bonds and challenge bonds). */
export async function signPermit(
  account: LocalAccount,
  cfg: ChainworkConfig,
  publicClient: PublicClient,
  value: bigint,
  deadline: bigint,
): Promise<Hex> {
  const nonce = await publicClient.readContract({
    address: cfg.token,
    abi: fiatTokenV2_2Abi,
    functionName: "nonces",
    args: [account.address],
  });
  return account.signTypedData({
    domain: domainOf(cfg),
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner: account.address, spender: cfg.escrow, value, nonce, deadline },
  });
}
