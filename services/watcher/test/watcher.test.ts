/**
 * Watcher + evaluator acceptance:
 *   good output → no challenge; bad output → challenged → rejected;
 *   a challenged good output → completed.
 * Requires the local anvil deployment.
 */
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, http, type Address } from "viem";
import { foundry } from "viem/chains";
import { JobStatus } from "@chainwork/types";
import { Chainwork, buildTerms, signFunding } from "@chainwork/sdk";
import {
  chainworkFor,
  loadServiceConfig,
  type ServiceConfig,
} from "@chainwork/service-kit";
import { RUN_LOCAL, anvilAccount, chainNow, isChainUp, localPublicClient, tempDir } from "@chainwork/service-kit/testing";
import { buildDataset, canonicalJson, fetchTransfers, hashText, jobSpecDescription } from "@chainwork/checks";
import { WatcherStore } from "../src/store.js";
import { watchOnce } from "../src/watcher.js";
import { EvaluatorStore } from "../../evaluator/src/store.js";
import { resolveOnce } from "../../evaluator/src/evaluator.js";

const chainUp = await isChainUp();
const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!RUN_LOCAL || !chainUp)("watcher and evaluator on the local chain", { timeout: 120_000 }, () => {
  let watcherConfig: ServiceConfig;
  let providerCw: Chainwork;
  let watcherCw: Chainwork;
  let evaluatorCw: Chainwork;
  let evaluatorConfig: ServiceConfig;
  let web: FastifyInstance;
  let watcherStore: WatcherStore;
  let evaluatorStore: EvaluatorStore;
  const outputs = new Map<string, string>();
  const pc = localPublicClient();
  const client = anvilAccount(1);
  const provider = anvilAccount(3);
  const evaluatorSigner = anvilAccount(7);

  const workerUrls = (): Record<string, string> => {
    const address = web.server.address();
    const port = typeof address === "object" && address ? address.port : 4199;
    return { [provider.address.toLowerCase()]: `http://127.0.0.1:${port}` };
  };

  const makeJob = async (description: string, budget = 20_000n): Promise<bigint> => {
    const now = await chainNow(pc);
    const terms = buildTerms({
      provider: provider.address,
      evaluator: evaluatorSigner.address,
      budget,
      description,
      expiresIn: 1800,
      challengeWindow: 60,
      now,
    });
    const sig = await signFunding(client, watcherConfig.cfg, terms, { validBefore: BigInt(now + 600) });
    const { jobId } = await watcherCw.fund(sig, description);
    await providerCw.accept(jobId);
    return jobId;
  };

  const submit = async (jobId: bigint, output: string): Promise<void> => {
    outputs.set(jobId.toString(), output);
    await providerCw.submit(jobId, hashText(output));
  };

  beforeAll(async () => {
    process.env.NETWORK = "local";
    process.env.AGENT_ROLE = "watcher";
    watcherConfig = loadServiceConfig();
    watcherCw = chainworkFor(watcherConfig);
    process.env.AGENT_ROLE = "evaluator";
    evaluatorConfig = loadServiceConfig();
    evaluatorCw = chainworkFor(evaluatorConfig);
    process.env.AGENT_ROLE = "specialist-data";
    const providerConfig = loadServiceConfig();
    const transport = http("http://127.0.0.1:8545");
    providerCw = new Chainwork(
      providerConfig.cfg,
      pc,
      createWalletClient({ account: provider, chain: foundry, transport }),
    );

    web = Fastify();
    web.get("/jobs/:id/output", async (req, reply) => {
      const body = outputs.get((req.params as { id: string }).id);
      if (body === undefined) return reply.status(404).send({ error: "not ready" });
      return reply.type("application/json").send(body);
    });
    await web.listen({ port: 0, host: "127.0.0.1" });

    watcherStore = WatcherStore.open(join(tempDir("chainwork-watcher-"), "watcher.sqlite"));
    evaluatorStore = EvaluatorStore.open(join(tempDir("chainwork-evaluator-"), "evaluator.sqlite"));
  });

  afterAll(async () => {
    await web?.close();
    watcherStore?.close();
    evaluatorStore?.close();
  });

  it("does not challenge a correct dataset", async () => {
    const latest = Number(await pc.getBlockNumber());
    const description = jobSpecDescription({
      v: 1,
      kind: "dataset",
      subject: client.address,
      token: watcherConfig.cfg.token,
      fromBlock: 0,
      toBlock: latest,
    });
    const jobId = await makeJob(description);
    const transfers = await fetchTransfers(pc, {
      subject: client.address,
      token: watcherConfig.cfg.token,
      fromBlock: 0,
      toBlock: latest,
    });
    const output = canonicalJson(
      buildDataset({ subject: client.address, token: watcherConfig.cfg.token, fromBlock: 0, toBlock: latest }, transfers),
    );
    await submit(jobId, output);

    const result = await watchOnce({
      config: watcherConfig,
      cw: watcherCw,
      store: watcherStore,
      logger,
      workerUrls: workerUrls(),
    });
    expect(result.challenged).toBe(0);
    expect((await watcherCw.getJobExt(jobId)).challenged).toBe(false);
    expect(watcherStore.get(jobId.toString())?.verdict).toBe("ok");
  });

  it("challenges a dataset that does not match the chain, and the evaluator rejects it", async () => {
    const latest = Number(await pc.getBlockNumber());
    const description = jobSpecDescription({
      v: 1,
      kind: "dataset",
      subject: client.address,
      token: watcherConfig.cfg.token,
      fromBlock: 0,
      toBlock: latest,
    });
    const jobId = await makeJob(description);
    const bogus = canonicalJson({
      v: 1,
      subject: client.address.toLowerCase(),
      token: watcherConfig.cfg.token.toLowerCase(),
      fromBlock: 0,
      toBlock: latest,
      transfers: [],
    });
    await submit(jobId, bogus);

    const result = await watchOnce({
      config: watcherConfig,
      cw: watcherCw,
      store: watcherStore,
      logger,
      workerUrls: workerUrls(),
    });
    expect(result.challenged).toBe(1);
    expect((await watcherCw.getJobExt(jobId)).challenged).toBe(true);

    const resolved = await resolveOnce({
      config: evaluatorConfig,
      cw: evaluatorCw,
      store: evaluatorStore,
      logger,
      workerUrls: workerUrls(),
    });
    expect(resolved.rejected).toBeGreaterThanOrEqual(1);
    expect((await evaluatorCw.getJob(jobId)).status).toBe(JobStatus.Rejected);
  });

  it("completes a challenged good job", async () => {
    const latest = Number(await pc.getBlockNumber());
    const description = jobSpecDescription({
      v: 1,
      kind: "dataset",
      subject: client.address,
      token: watcherConfig.cfg.token,
      fromBlock: 0,
      toBlock: latest,
    });
    const jobId = await makeJob(description);
    const transfers = await fetchTransfers(pc, {
      subject: client.address,
      token: watcherConfig.cfg.token,
      fromBlock: 0,
      toBlock: latest,
    });
    const output = canonicalJson(
      buildDataset({ subject: client.address, token: watcherConfig.cfg.token, fromBlock: 0, toBlock: latest }, transfers),
    );
    await submit(jobId, output);
    // Someone disputes it even though the work is good; the evaluator must complete it.
    await watcherCw.challenge(jobId, hashText("manual dispute"));

    const resolved = await resolveOnce({
      config: evaluatorConfig,
      cw: evaluatorCw,
      store: evaluatorStore,
      logger,
      workerUrls: workerUrls(),
    });
    expect(resolved.completed).toBeGreaterThanOrEqual(1);
    expect((await evaluatorCw.getJob(jobId)).status).toBe(JobStatus.Completed);
  });
});
