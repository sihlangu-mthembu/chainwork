/**
 * Worker acceptance: 402 quote → signed PAYMENT-SIGNATURE → 202 jobId → accept → output served.
 * Requires the local anvil deployment (see facilitator tests).
 */
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EscrowPaymentPayload } from "@chainwork/types";
import { signFunding } from "@chainwork/sdk";
import {
  buildEscrowQuote,
  chainworkFor,
  loadServiceConfig,
  localRoleAddress,
  payloadFromSignature,
  termsFromQuote,
  toUnits,
  type ServiceConfig,
} from "@chainwork/service-kit";
import { RUN_LOCAL, anvilAccount, chainNow, isChainUp, localPublicClient, tempDir, waitFor } from "@chainwork/service-kit/testing";
import { canonicalJson, hashText, jobSpecDescription, parseJobSpec, verifyOutput } from "@chainwork/checks";
import { buildWorkerApp, type SettleFn } from "../src/server.js";
import { WorkerStore } from "../src/store.js";
import { makeWork } from "../src/work.js";

const chainUp = await isChainUp();

describe.skipIf(!RUN_LOCAL || !chainUp)("worker-kit on the local chain", () => {
  let config: ServiceConfig;
  let app: FastifyInstance;
  let store: WorkerStore;
  const pc = localPublicClient();
  const client = anvilAccount(1);
  const provider = anvilAccount(3);
  const evaluator = localRoleAddress("evaluator");
  const cw = () => chainworkFor(config);

  beforeAll(async () => {
    process.env.NETWORK = "local";
    process.env.AGENT_ROLE = "specialist-data";
    config = loadServiceConfig();
    store = WorkerStore.open(join(tempDir("chainwork-worker-"), "worker.sqlite"));
    const workerCw = chainworkFor(config);
    const settledJobs = new Map<string, string>();
    const settle: SettleFn = async (payload: EscrowPaymentPayload) => {
      const cached = settledJobs.get(payload.payload.signature);
      if (cached) {
        return {
          success: true,
          jobId: cached,
          alreadySettled: true,
          network: `eip155:${config.cfg.chainId}` as "eip155:44005",
        };
      }
      const result = await workerCw.fund(
        {
          client: payload.payload.client,
          terms: payload.payload.terms,
          validAfter: BigInt(payload.payload.validAfter),
          validBefore: BigInt(payload.payload.validBefore),
          signature: payload.payload.signature,
        },
        payload.payload.description,
      );
      settledJobs.set(payload.payload.signature, result.jobId.toString());
      return {
        success: true,
        jobId: result.jobId.toString(),
        txHash: result.hash,
        network: `eip155:${config.cfg.chainId}` as "eip155:44005",
      };
    };
    app = buildWorkerApp({
      config,
      store,
      work: makeWork({ kind: "dataset", cw: workerCw, config, workerUrls: {} }),
      kind: "dataset",
      price: toUnits("0.03"),
      evaluator,
      publicUrl: "http://worker.test",
      settle,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    store?.close();
  });

  it("quotes 402, funds, accepts and serves the exact dataset bytes", { timeout: 90_000 }, async () => {
    const now = await chainNow(pc);
    const latest = Number(await pc.getBlockNumber());
    const spec = {
      v: 1,
      kind: "dataset",
      subject: client.address,
      token: config.cfg.token,
      fromBlock: 0,
      toBlock: latest,
    } as const;
    const description = jobSpecDescription(spec);

    const quote = await buildEscrowQuote(cw(), config.cfg, {
      provider: provider.address,
      evaluator,
      budget: toUnits("0.03"),
      description,
      resource: "http://worker.test/jobs",
      expiresIn: 1800,
      challengeWindow: 60,
      now,
    });
    const signature = await signFunding(client, config.cfg, termsFromQuote(quote), { validBefore: BigInt(now + 600) });
    const payload = payloadFromSignature(signature, description, config.cfg);

    const challenge = await app.inject({
      method: "POST",
      url: "/jobs",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ description }),
    });
    expect(challenge.statusCode).toBe(402);
    const header = challenge.headers["payment-required"];
    expect(typeof header).toBe("string");
    const required = JSON.parse(Buffer.from(String(header), "base64").toString("utf8")) as {
      x402Version: number;
      accepts: Array<{ scheme: string; amount: string }>;
    };
    expect(required.x402Version).toBe(2);
    expect(required.accepts[0]?.scheme).toBe("escrow");
    expect(required.accepts[0]?.amount).toBe(toUnits("0.03").toString());

    const paid = await app.inject({
      method: "POST",
      url: "/jobs",
      headers: {
        "content-type": "application/json",
        "payment-signature": Buffer.from(
          JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
        ).toString("base64"),
      },
      payload: JSON.stringify({ description }),
    });
    expect(paid.statusCode).toBe(202);
    const { jobId } = paid.json() as { jobId: string };
    expect(jobId).toMatch(/^\d+$/);
    expect(paid.headers["payment-response"]).toBeTruthy();

    const output = await waitFor(
      async () => {
        const res = await app.inject({ method: "GET", url: `/jobs/${jobId}/output` });
        return res.statusCode === 200 ? res.body : undefined;
      },
      { timeoutMs: 30_000, label: "worker output" },
    );
    const job = await cw().getJob(BigInt(jobId));
    const ext = await cw().getJobExt(BigInt(jobId));
    expect(hashText(output)).toBe(ext.deliverable);

    const parsedSpec = parseJobSpec(job.description);
    expect(parsedSpec).toBeDefined();
    if (parsedSpec) {
      const result = await verifyOutput(parsedSpec, output, {
        pc,
        token: config.cfg.token,
        jobId: BigInt(jobId),
        childJobIds: [],
        fetchOutput: async () => output,
      });
      expect(result).toEqual({ ok: true });
    }
    expect(JSON.parse(output)).toMatchObject({ v: 1, subject: client.address.toLowerCase() });

    const duplicate = await app.inject({
      method: "POST",
      url: "/jobs",
      headers: {
        "content-type": "application/json",
        "payment-signature": Buffer.from(
          JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
        ).toString("base64"),
      },
      payload: JSON.stringify({ description }),
    });
    expect(duplicate.statusCode).toBe(202);
    expect((duplicate.json() as { duplicate?: boolean }).duplicate).toBe(true);
    expect(canonicalJson(JSON.parse(output))).toBe(output);
  });
});
