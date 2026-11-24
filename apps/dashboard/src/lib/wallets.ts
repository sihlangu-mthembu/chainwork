/**
 * SPDX-License-Identifier: MIT
 * The demo's role wallets. Addresses only — keys live in a local .env / keystore and are never
 * shipped to a browser. Source of truth: docs/CONTEXT.md ("Wallets", addresses only).
 */
import type { Address } from "@chainwork/types";

export interface RoleWallet {
  role: string;
  label: string;
  address: Address;
  note?: string;
}

/** Aevum testnet role wallets. */
export const AEVUM_ROLE_WALLETS: readonly RoleWallet[] = [
  {
    role: "facilitator",
    label: "deployer / facilitator relayer",
    address: "0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1",
    note: "pays gas for gasless client funding",
  },
  { role: "client", label: "client", address: "0xbE213deEEf489afDf67842F411472Aa90f8f8D77", note: "signs the funding authorization" },
  {
    role: "coordinator",
    label: "coordinator",
    address: "0x28C0B52FAd3Ce860324C3DA7DfDdcD7b94cEA40A",
    note: "starts at 0 tUSD8 — that is the demo",
  },
  { role: "specialist-data", label: "specialist-data", address: "0xa5130D2A006d13750Fbc2E7b66cad6Cb9ad9B5c3" },
  { role: "specialist-bad", label: "specialist-bad", address: "0x80Dec5f266418EB8ae26A6C2Ee592c9082E4c00d", note: "delivers invalid work" },
  { role: "backup", label: "backup analysis agent", address: "0x7117c6741d15f794751C447Df5F96F48501D1DA9" },
  { role: "watcher", label: "watcher", address: "0xFCEB78c36c369d0C90a6c91d4498A1991Ed036bd", note: "challenges bad output" },
  { role: "evaluator", label: "evaluator", address: "0x6024AaEC247E11c53c9799ED018D67Ee2B5373e4" },
];

/** The same roles on a local anvil chain (default mnemonic, accounts 0-7). */
export const LOCAL_ROLE_WALLETS: readonly RoleWallet[] = [
  { role: "facilitator", label: "deployer / facilitator relayer", address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", note: "pays gas for gasless client funding" },
  { role: "client", label: "client", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", note: "signs the funding authorization" },
  { role: "coordinator", label: "coordinator", address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", note: "starts at 0 tUSD8 — that is the demo" },
  { role: "specialist-data", label: "specialist-data", address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" },
  { role: "specialist-bad", label: "specialist-bad", address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", note: "delivers invalid work" },
  { role: "backup", label: "backup analysis agent", address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" },
  { role: "watcher", label: "watcher", address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9", note: "challenges bad output" },
  { role: "evaluator", label: "evaluator", address: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955" },
];

/** Role wallets for the chain being watched. */
export function roleWallets(chainId: number): readonly RoleWallet[] {
  return chainId === 31337 ? LOCAL_ROLE_WALLETS : AEVUM_ROLE_WALLETS;
}

/** @deprecated use roleWallets(chainId); kept for the Aevum default. */
export const ROLE_WALLETS = AEVUM_ROLE_WALLETS;

/** Plain names people recognise in the demo, keyed by role. */
const ROLE_NAMES: Record<string, string> = {
  facilitator: "Facilitator",
  client: "Client",
  coordinator: "Coordinator agent",
  "specialist-data": "Data agent",
  "specialist-bad": "Unreliable metrics agent",
  backup: "Backup metrics agent",
  watcher: "Watcher",
  evaluator: "Evaluator",
};

/** A readable name for an address: its demo role, the client smart account, or null. */
export function nameFor(address: string, chainId: number, clientAccount?: string | null): string | null {
  const a = address.toLowerCase();
  if (clientAccount && a === clientAccount.toLowerCase()) return "Client smart account";
  const hit = roleWallets(chainId).find((w) => w.address.toLowerCase() === a);
  return hit ? (ROLE_NAMES[hit.role] ?? hit.label) : null;
}

/** The coordinator is the interesting reputation subject in the demo (T4.3). */
export const COORDINATOR: Address = "0x28C0B52FAd3Ce860324C3DA7DfDdcD7b94cEA40A";

export function coordinatorFor(chainId: number): Address {
  return roleWallets(chainId).find((w) => w.role === "coordinator")?.address ?? COORDINATOR;
}
