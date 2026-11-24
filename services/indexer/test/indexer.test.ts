/**
 * Indexer acceptance: events land in SQLite, restarts resume without duplicates, and no
 * eth_getLogs range exceeds 1,000 blocks (we use 500).
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWalletClient, http, type PublicClient } from "viem";
import { foundry } from "viem/chains";
import { Chainwork, buildTerms, signFunding } from "@chainwork/sdk";
import { chainworkFor, loadServiceConfig } from "@chainwork/service-kit";
import { RUN_LOCAL, anvilAccount, chainNow, isChainUp, localPublicClient, tempDir } from "@chainwork/service-kit/testing";
import { indexOnce } from "../src/indexer.js";
import { IndexerStore } from "../src/store.js";

const chainUp = await isChainUp();

describe("indexer chunking", () => {
  it("never asks for more than 500 blocks and pages to the head", async () => {
    const config = { ...loadServiceConfigForTest(), deployment: { ...loadServiceConfigForTest().deployment, deployedAtBlock: 0 } };
    const calls: Array<{ from: bigint; to: bigint }> = [];
    const pc = {
      getBlockNumber: async () => 4_999n,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push({ from: fromBlock, to: toBlock });
        return [];
      },
    } as unknown as PublicClient;
    const store = IndexerStore.open(":memory:");
    const pass = await indexOnce({ config, store, pc, chunk: 500 });
    expect(pass.latest).toBe(4_999n);
    expect(calls.length).toBe(10);
    expect(calls.every((c) => c.to - c.from + 1n <= 500n)).toBe(true);
    expect(store.cursor()).toBe(4_999n);
    store.close();
  });

  it("refuses a chunk over 1,000 blocks", async () => {
    const config = loadServiceConfigForTest();
    const store = IndexerStore.open(":memory:");
    await expect(
      indexOnce({ config, store, pc: { getBlockNumber: async () => 0n } as unknown as PublicClient, chunk: 1_001 }),
    ).rejects.toThrow(/1,000/);
    store.close();
  });
});

describe.skipIf(!RUN_LOCAL || !chainUp)("indexer on the local chain", { timeout: 90_000 }, () => {
  it("indexes a new job and resumes from the cursor after a restart", async () => {
    process.env.NETWORK = "local";
    process.env.AGENT_ROLE = "deployer";
    const config = loadServiceConfig();
    const pc = localPublicClient();
    const path = join(tempDir("chainwork-indexer-"), "indexer.sqlite");
    const store = IndexerStore.open(path);

    const first = await indexOnce({ config, store });
    expect(first.inserted).toBeGreaterThan(0);

    const wallet = createWalletClient({
      account: anvilAccount(0),
      chain: foundry,
      transport: http("http://127.0.0.1:8545"),
    });
    const relayer = new Chainwork(config.cfg, pc, wallet);
    for (let i = 0; i < 2; i++) {
      const now = await chainNow(pc);
      const description = `indexer probe ${i} ${Date.now()}`;
      const terms = buildTerms({
        provider: anvilAccount(3).address,
        evaluator: anvilAccount(7).address,
        budget: 10_000n,
        description,
        expiresIn: 1800,
        challengeWindow: 30,
        now,
      });
      const sig = await signFunding(anvilAccount(1), config.cfg, terms, { validBefore: BigInt(now + 600) });
      const { jobId } = await relayer.fund(sig, description);
      const pass = await indexOnce({ config, store });
      expect(pass.inserted).toBeGreaterThan(0);
      const events = store.byJob(jobId.toString());
      expect(events.some((e) => e.event === "JobCreated")).toBe(true);
      expect(events.some((e) => e.event === "JobFunded")).toBe(true);
    }

    const count = store.count();
    store.close();
    // Restart: reopen the same file and re-index; the overlap re-scan must not duplicate.
    const reopened = IndexerStore.open(path);
    await indexOnce({ config, store: reopened });
    expect(reopened.count()).toBe(count);
    expect(reopened.cursor()).toBeGreaterThan(0n);
    reopened.close();
    void chainworkFor;
  });
});

function loadServiceConfigForTest() {
  process.env.NETWORK ??= "local";
  process.env.AGENT_ROLE ??= "deployer";
  return loadServiceConfig();
}
