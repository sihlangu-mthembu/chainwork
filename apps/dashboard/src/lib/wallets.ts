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

export const ROLE_WALLETS: readonly RoleWallet[] = [
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

/** The coordinator is the interesting reputation subject in the demo (T4.3). */
export const COORDINATOR: Address = "0x28C0B52FAd3Ce860324C3DA7DfDdcD7b94cEA40A";
