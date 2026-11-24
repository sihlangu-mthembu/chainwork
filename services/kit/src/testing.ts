/**
 * Test helpers. The chain-dependent tests are gated on CHAINWORK_LOCAL=1 so `pnpm test` stays green
 * on a laptop or CI runner without anvil; the services CI job sets it after deploying locally.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createTestClient, http, type PublicClient } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const LOCAL_MNEMONIC = "test test test test test test test test test test test junk";
export const RUN_LOCAL = process.env.CHAINWORK_LOCAL === "1";
export const LOCAL_RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";

/** anvil roles: 0 deployer/relayer, 1 client, 2 coordinator (0 tUSD8), 3 specialist-data, ... 7 evaluator. */
export function anvilAccount(index: number): ReturnType<typeof mnemonicToAccount> {
  return mnemonicToAccount(LOCAL_MNEMONIC, { addressIndex: index });
}

export function localPublicClient(rpcUrl = LOCAL_RPC): PublicClient {
  return createPublicClient({ chain: foundry, transport: http(rpcUrl, { retryCount: 1, timeout: 10_000 }) });
}

export async function isChainUp(rpcUrl = LOCAL_RPC): Promise<boolean> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(1_500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Chain time, in seconds. The pending block is the clock the next transaction will use. */
export async function chainNow(pc: PublicClient): Promise<number> {
  return Number((await pc.getBlock({ blockTag: "pending" })).timestamp);
}

/** Move the local chain forward and mine a block (challenge windows, refunds). */
export async function warp(seconds: number, rpcUrl = LOCAL_RPC): Promise<void> {
  const tc = createTestClient({ chain: foundry, mode: "anvil", transport: http(rpcUrl) });
  await tc.increaseTime({ seconds });
  await tc.mine({ blocks: 1 });
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export async function waitFor<T>(
  fn: () => Promise<T | undefined | false | null>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const intervalMs = opts.intervalMs ?? 250;
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${opts.label ?? "condition"}.`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
