/**
 * End-to-end against a local anvil chain running Circle's real FiatToken V2.2 as tUSD8.
 *   anvil --hardfork shanghai &
 *   forge script contracts/script/Deploy.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast
 *   CHAINWORK_LOCAL=1 pnpm -F @chainwork/sdk test
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPublicClient, createTestClient, createWalletClient, http, keccak256, stringToBytes, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { agentAccountAbi, budgetGuardHookAbi, fiatTokenV2_2Abi } from "@chainwork/types/abis";
import { JobStatus } from "@chainwork/types";
import {
  Chainwork,
  ChainworkError,
  buildReceipt,
  buildSubTerms,
  buildTerms,
  configFromDeployment,
  readTree,
  signFunding,
  signFundingWithSession,
  termsHash,
  toUnits,
  type DeploymentJson,
} from "../src/index.js";

const RUN = process.env.CHAINWORK_LOCAL === "1";
const MNEMONIC = "test test test test test test test test test test test junk";
const acct = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });

describe.skipIf(!RUN)("local anvil end-to-end", { timeout: 30_000 }, () => {
  const d = JSON.parse(readFileSync(new URL("../../../deployments/local.json", import.meta.url), "utf8")) as DeploymentJson;
  const cfg = configFromDeployment(d);
  const transport = http("http://127.0.0.1:8545");
  const pc = createPublicClient({ chain: foundry, transport });
  const tc = createTestClient({ chain: foundry, mode: "anvil", transport });
  const as = (i: number) => new Chainwork(cfg, pc, createWalletClient({ account: acct(i), chain: foundry, transport }));
  const relayer = as(0);
  const client = acct(1);
  const provider = as(3); // specialist-data: funded, new agent (50% bond)
  const backup = as(5);
  const evaluator = acct(7).address;
  const bal = (a: Address) => pc.readContract({ address: cfg.token, abi: fiatTokenV2_2Abi, functionName: "balanceOf", args: [a] });
  const chainNow = async () => Number((await pc.getBlock()).timestamp);
  const warp = async (s: number) => {
    await tc.increaseTime({ seconds: s });
    await tc.mine({ blocks: 1 });
  };

  it("computes termsHash exactly like the contract", async () => {
    const t = buildTerms({ provider: acct(3).address, evaluator, budget: toUnits("0.10"), description: "x", expiresIn: 3600, now: await chainNow() });
    expect(termsHash(cfg, client.address, t)).toBe(await relayer.termsHashOnChain(client.address, t));
  });

  it("runs a funded tree to settlement and explains reverts in plain English", async () => {
    const now = await chainNow();
    const description = "Supplier due-diligence pack";
    const terms = buildTerms({ provider: acct(3).address, evaluator, budget: toUnits("0.10"), description, expiresIn: 3600, challengeWindow: 30, now });
    const sig = await signFunding(client, cfg, terms, { validBefore: BigInt(now + 600) });
    const { jobId } = await relayer.fund(sig, description);
    expect((await relayer.getJob(jobId)).status).toBe(JobStatus.Funded);

    const providerStart = await bal(acct(3).address);
    // Bond and credit come from on-chain reputation, which improves as this provider completes jobs.
    const numbers = await provider.providerNumbers(acct(3).address, toUnits("0.10"));
    const { bond } = await provider.accept(jobId);
    expect(bond).toBe(numbers.bond);
    expect(bond).toBeLessThanOrEqual(toUnits("0.05")); // never above the new-agent rate

    const child = buildSubTerms({ provider: acct(5).address, evaluator, budget: toUnits("0.03"), expiredAt: BigInt(now + 1800), challengeWindow: 30 });
    const { childId } = await provider.subcontract(jobId, child, "FX rates");
    const room = await provider.maxSubcontract(jobId);
    await expect(provider.subcontract(jobId, { ...child, budget: room + 1n }, "too much")).rejects.toThrow(
      /^(Subcontracting that much would use|Only .* of the parent budget is left)/,
    );

    await backup.accept(childId);
    await backup.submit(childId, keccak256(stringToBytes("EURUSD=1.0842")));
    const err = await provider.submit(jobId, keccak256(stringToBytes("early"))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChainworkError);
    expect((err as ChainworkError).message).toBe("1 sub-job(s) are still open; settle them first.");

    await warp(31);
    await relayer.settleTree(jobId); // finalizes the child
    expect((await relayer.getJob(childId)).status).toBe(JobStatus.Completed);

    await provider.submitParent(jobId);
    expect(await relayer.windowRemaining(jobId, await chainNow())).toBeGreaterThan(0);
    await warp(31);
    await relayer.settleTree(jobId);

    const tree = await readTree(relayer, jobId);
    expect(tree.ui).toBe("Settled");
    expect(tree.children[0]?.ui).toBe("Settled");
    // provider: paid 0.10 - 0.03 to child = 0.07, bond returned
    expect(await bal(acct(3).address)).toBe(providerStart + toUnits("0.07"));

    const receipt = await buildReceipt(relayer, jobId, 0n);
    const paid = receipt.lines.filter((l) => l.outcome === "paid").map((l) => BigInt(l.amount));
    expect(paid.reduce((a, b) => a + b, 0n)).toBe(toUnits("0.10"));
  });

  it("funds through an AgentAccount session key, and refuses out-of-scope signatures", async () => {
    const owner = createWalletClient({ account: acct(1), chain: foundry, transport });
    const account = d.clientAccount as Address;
    // A fresh session key each run; caps are set relative to what the account already spent today,
    // so the test also passes on a reused chain (where earlier runs count toward the daily cap).
    const sessionKey = mnemonicToAccount(MNEMONIC, { addressIndex: 10 + Math.floor(Math.random() * 1000) });
    const now = await chainNow();
    const spent = await pc.readContract({ address: cfg.budgetGuard as Address, abi: budgetGuardHookAbi, functionName: "spentToday", args: [account] });
    await pc.waitForTransactionReceipt({
      hash: await owner.writeContract({
        address: account,
        abi: agentAccountAbi,
        functionName: "execute",
        args: [cfg.budgetGuard as Address, 0n, encodeSetLimits(toUnits("0.50"), spent + toUnits("1"))],
      }),
    });
    await pc.waitForTransactionReceipt({
      hash: await owner.writeContract({
        address: account,
        abi: agentAccountAbi,
        functionName: "addSession",
        args: [sessionKey.address, BigInt(now + 86_400), toUnits("0.20"), spent + toUnits("0.50")],
      }),
    });

    const description = "Analysis";
    const t = buildTerms({ provider: acct(3).address, evaluator, budget: toUnits("0.10"), description, expiresIn: 3600, hook: cfg.budgetGuard, now });
    const sig = await signFundingWithSession(sessionKey, cfg, account, t, { validBefore: BigInt(now + 600) });
    const { jobId } = await relayer.fund(sig, description);
    expect((await relayer.getJob(jobId)).client.toLowerCase()).toBe(account.toLowerCase());

    const big = buildTerms({ provider: acct(3).address, evaluator, budget: toUnits("0.30"), description, expiresIn: 3600, hook: cfg.budgetGuard, now });
    const bad = await signFundingWithSession(sessionKey, cfg, account, big, { validBefore: BigInt(now + 600) });
    await expect(relayer.fund(bad, description)).rejects.toThrow(
      "The signature doesn't match these exact job terms, or the session key isn't allowed to sign them.",
    );
  });
});

import { encodeFunctionData } from "viem";
function encodeSetLimits(perJob: bigint, perDay: bigint) {
  return encodeFunctionData({ abi: budgetGuardHookAbi, functionName: "setLimits", args: [perJob, perDay] });
}
