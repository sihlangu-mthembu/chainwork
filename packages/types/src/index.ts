/**
 * @chainwork/types — FROZEN (L0). Shared by SDK, services, agents and dashboard.
 * Mirrors interfaces/IChainworkEscrow.sol. Chain facts come from docs/CONTEXT.md only.
 * Changes need a PR reviewed by both lanes.
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

// ------------------------------------------------------------------ chain

export const AEVUM_TESTNET = {
  id: 44005,
  name: "Aevum Testnet",
  caip2: "eip155:44005",
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrl: "https://rpc-test.qday.info",
  wsUrl: "wss://rpc-test.qday.info",
  explorerUrl: "https://explorer-test.qday.info",
  explorerApi: "https://explorer-test.qday.info/api/v2",
  /** eth_getLogs rejects ranges over 1,000 blocks. Indexers page in 500-block chunks. */
  maxLogRange: 1000,
  /** Aevum has no Cancun opcodes. Contracts must compile for shanghai. */
  evmVersion: "shanghai",
} as const;

export const TUSD8 = {
  address: "0x456569838f1d43009A91ebA4263147Afd7233483" as Address,
  decimals: 6,
  /** EIP-712 domain, verified live: DOMAIN_SEPARATOR matches. */
  domain: {
    name: "tUSD8",
    version: "2",
    chainId: 44005,
    verifyingContract: "0x456569838f1d43009A91ebA4263147Afd7233483" as Address,
  },
} as const;

export const ENTRYPOINT_V07: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/** Filled in after deployment (scripts write deployments/aevum.json). */
export interface Deployment {
  chainId: 44005;
  escrow: Address;
  reputation: Address;
  budgetGuard: Address;
  hashVerifier: Address;
  signedDataVerifier: Address;
  deployedAtBlock: number;
  commit: string;
}

// ---------------------------------------------------------------- EIP-712

/** tUSD8 EIP-3009 typed data the client signs to fund a job. `to` is the escrow, `nonce` is termsHash. */
export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** tUSD8 EIP-2612 permit used for bonds and challenge bonds. */
export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * termsHash = keccak256(abi.encode(TERMS_TYPEHASH, chainId, escrow, client, terms))
 * where `terms` is JobTerms encoded field by field in the order below (all static types).
 */
export const TERMS_TYPE_STRING =
  "ChainworkJobTerms(address provider,address evaluator,address verifier,address hook,uint64 expiredAt,uint64 challengeWindow,uint256 budget,bytes32 verifierSpec,bytes32 descriptionHash,bytes32 salt)";

// ------------------------------------------------------------------ jobs

/** Order matches IERC8183.JobStatus. */
export enum JobStatus {
  Open = 0,
  Funded = 1,
  Submitted = 2,
  Completed = 3,
  Rejected = 4,
  Expired = 5,
}

export interface Job {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: JobStatus;
  hook: Address;
}

export interface JobExt {
  parentId: bigint;
  depth: number;
  openChildren: number;
  accepted: boolean;
  challenged: boolean;
  verifier: Address;
  challengeWindow: bigint;
  submittedAt: bigint;
  bond: bigint;
  allocated: bigint;
  paidToChildren: bigint;
  verifierSpec: Hex;
  deliverable: Hex;
  challenger: Address;
  challengeBond: bigint;
}

export interface JobTerms {
  provider: Address;
  evaluator: Address;
  verifier: Address;
  hook: Address;
  expiredAt: bigint;
  challengeWindow: bigint;
  budget: bigint;
  verifierSpec: Hex;
  descriptionHash: Hex;
  salt: Hex;
}

export interface SubJobTerms {
  provider: Address;
  evaluator: Address;
  verifier: Address;
  expiredAt: bigint;
  challengeWindow: bigint;
  budget: bigint;
  verifierSpec: Hex;
}

/** UI-level state derived from Job + JobExt (dashboard and receipts use these labels). */
export type UiJobState =
  | "Quoted"
  | "Escrowed"
  | "Accepted"
  | "Subcontracted"
  | "Submitted"
  | "Challenged"
  | "Verified"
  | "Settled"
  | "Rejected"
  | "Refunded";

export interface JobNode {
  job: Job;
  ext: JobExt;
  ui: UiJobState;
  children: JobNode[];
}

// --------------------------------------------------- x402 "escrow" scheme

/** See docs/X402_ESCROW_SCHEME.md. One entry of PaymentRequired.accepts. */
export interface EscrowPaymentRequirements {
  scheme: "escrow";
  network: "eip155:44005";
  asset: Address; // TUSD8.address
  amount: string; // budget in base units, decimal string
  payTo: Address; // the escrow contract, never the worker
  resource: string;
  description: string;
  maxTimeoutSeconds: number; // validBefore window for the EIP-3009 signature
  extra: {
    escrow: Address;
    provider: Address;
    evaluator: Address;
    verifier: Address;
    verifierSpec: Hex;
    challengeWindow: number; // seconds
    expiredAt: number; // unix seconds
    bond: string; // what the provider will post at acceptJob, base units
    creditLimit: string; // provider's subcontract credit, base units
    worstCaseLoss: string; // bond + creditLimit exposure shown to the client, base units
    reputationScore: number; // 0..10000
    salt: Hex;
    descriptionHash: Hex;
  };
}

export interface EscrowPaymentRequired {
  x402Version: 2;
  error?: string;
  accepts: EscrowPaymentRequirements[];
}

/** Body of the PAYMENT-SIGNATURE header (base64 JSON) for the escrow scheme. */
export interface EscrowPaymentPayload {
  x402Version: 2;
  scheme: "escrow";
  network: "eip155:44005";
  payload: {
    client: Address;
    terms: JobTerms;
    description: string;
    validAfter: string;
    validBefore: string;
    /** EIP-712 ReceiveWithAuthorization signature: 65-byte EOA sig or ERC-1271 bytes. */
    signature: Hex;
  };
}

/** Body of the PAYMENT-RESPONSE header after /settle. */
export interface EscrowSettleResponse {
  success: boolean;
  jobId?: string;
  txHash?: Hex;
  network: "eip155:44005";
  errorReason?: string;
}

// ------------------------------------------------------------- receipts

export interface ReceiptLine {
  jobId: string;
  parentId: string | null;
  provider: Address;
  amount: string; // base units
  outcome: "paid" | "refunded" | "bond-returned" | "bond-slashed" | "challenge-bond";
  txHash: Hex;
}

export interface TreeReceipt {
  rootId: string;
  client: Address;
  totalFunded: string;
  lines: ReceiptLine[];
  generatedAt: string; // ISO time
}
