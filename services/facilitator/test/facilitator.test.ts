/**
 * Facilitator acceptance tests, against the local anvil deployment:
 *   anvil --hardfork shanghai &
 *   forge script contracts/script/Deploy.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast
 *   CHAINWORK_LOCAL=1 pnpm -F facilitator test
 */
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Address } from "viem";
import { fiatTokenV2_2Abi } from "@chainwork/types/abis";
import { JobStatus } from "@chainwork/types";
import { signFunding, type Chainwork } from "@chainwork/sdk";
import {
  buildEscrowQuote,
  chainworkFor,
  loadServiceConfig,
  payloadFromSignature,
  termsFromQuote,
  toUnits,
  type ServiceConfig,
} from "@chainwork/service-kit";
import {
  RUN_LOCAL,
  anvilAccount,
  chainNow,
  isChainUp,
  localPublicClient,
  tempDir,
} from "@chainwork/service-kit/testing";
import { buildApp } from "../src/app.js";
import { SettlementStore } from "../src/settle.js";

const chainUp = await isChainUp();

describe.skipIf(!RUN_LOCAL || !chainUp)("facilitator on the local chain", () => {
  let config: ServiceConfig;
  let cw: Chainwork;
  let app: FastifyInstance;
  let store: SettlementStore;
  let dbPath: string;
  const pc = localPublicClient();
  const client = anvilAccount(1);
  const coordinator = anvilAccount(2); // deliberately 0 tUSD8
  const provider = anvilAccount(3);
  const backup = anvilAccount(5);
  const evaluator = anvilAccount(7);

  const postTo = async (target: FastifyInstance, url: string, body: unknown) => {
    const res = await target.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    });
    return debug(url, res.json() as Record<string, unknown>);
  };
  const post = (url: string, body: unknown) => postTo(app, url, body);

  const debug = (url: string, body: Record<string, unknown>) => {
    if (process.env.FAC_LOG) console.log(url, JSON.stringify(body));
    return body;
  };

  const quoteAndSign = async (opts: {
    description: string;
    budget?: bigint;
    account?: ReturnType<typeof anvilAccount>;
    validBeforeDelta?: number;
    payTo?: Address;
  }) => {
    const now = await chainNow(pc);
    const description = opts.description;
    const requirements = await buildEscrowQuote(cw, config.cfg, {
      provider: provider.address,
      evaluator: evaluator.address,
      budget: opts.budget ?? toUnits("0.02"),
      description,
      resource: "http://worker.local/jobs",
      expiresIn: 1800,
      challengeWindow: 60,
      now,
    });
    if (opts.payTo) requirements.payTo = opts.payTo;
    const terms = termsFromQuote(requirements);
    const signature = await signFunding(opts.account ?? client, config.cfg, terms, {
      validBefore: BigInt(now + (opts.validBeforeDelta ?? 600)),
    });
    return { requirements, terms, payload: payloadFromSignature(signature, description, config.cfg), now };
  };

  const balanceOf = (who: Address) =>
    pc.readContract({ address: config.cfg.token, abi: fiatTokenV2_2Abi, functionName: "balanceOf", args: [who] });

  beforeAll(async () => {
    process.env.NETWORK = "local";
    config = loadServiceConfig();
    cw = chainworkFor(config);
    dbPath = join(tempDir("chainwork-facilitator-"), "settle.sqlite");
    store = SettlementStore.open(dbPath);
    app = buildApp({ config, store });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    store?.close();
  });

  it("advertises the escrow scheme", async () => {
    const res = await app.inject({ method: "GET", url: "/supported" });
    const body = res.json() as Record<string, unknown>;
    expect(body.scheme).toBe("escrow");
    expect(body.network).toBe(`eip155:${config.cfg.chainId}`);
    expect(String(body.asset).toLowerCase()).toBe(config.cfg.token.toLowerCase());
    expect((body.kinds as Array<Record<string, unknown>>)[0]?.scheme).toBe("escrow");
    expect(body.x402Version).toBe(2);
  });

  it("verifies a correctly signed quote without touching state", async () => {
    const { requirements, payload } = await quoteAndSign({ description: "Due-diligence pack" });
    const nonce = await cw.termsHashOnChain(payload.payload.client, payload.payload.terms);
    const usedBefore = await pc.readContract({
      address: config.cfg.token,
      abi: fiatTokenV2_2Abi,
      functionName: "authorizationState",
      args: [payload.payload.client, nonce],
    });
    const body = await post("/verify", { paymentPayload: payload, paymentRequirements: requirements });
    expect(body.isValid).toBe(true);
    expect(String(body.payer).toLowerCase()).toBe(client.address.toLowerCase());
    const usedAfter = await pc.readContract({
      address: config.cfg.token,
      abi: fiatTokenV2_2Abi,
      functionName: "authorizationState",
      args: [payload.payload.client, nonce],
    });
    expect(usedBefore).toBe(false);
    expect(usedAfter).toBe(false);
  });

  it("rejects tampered terms", async () => {
    const { requirements, payload } = await quoteAndSign({ description: "Tampered terms" });
    const tampered = JSON.parse(JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    tampered.payload.terms.provider = backup.address;
    requirements.extra.provider = backup.address;
    const body = await post("/verify", { paymentPayload: tampered, paymentRequirements: requirements });
    expect(body.isValid).toBe(false);
    expect(String(body.invalidReason)).toMatch(/signature|terms/i);
  });

  it("rejects a quote that pays anyone but the escrow", async () => {
    const { requirements, payload } = await quoteAndSign({ description: "Wrong payTo", payTo: backup.address });
    const body = await post("/verify", { paymentPayload: payload, paymentRequirements: requirements });
    expect(body.isValid).toBe(false);
    expect(body.invalidCode).toBe("invalid_escrow_recipient");
  });

  it("rejects a client that cannot cover the budget", async () => {
    const { requirements, payload } = await quoteAndSign({
      description: "No tUSD8",
      account: coordinator,
    });
    const body = await post("/verify", { paymentPayload: payload, paymentRequirements: requirements });
    expect(body.isValid).toBe(false);
    expect(body.invalidCode).toBe("insufficient_funds");
    expect(String(body.invalidReason)).toMatch(/needs/i);
  });

  it("rejects an expired payment signature", async () => {
    const { requirements, payload } = await quoteAndSign({
      description: "Expired signature",
      validBeforeDelta: -10,
    });
    const body = await post("/verify", { paymentPayload: payload, paymentRequirements: requirements });
    expect(body.isValid).toBe(false);
    expect(body.invalidCode).toBe("invalid_escrow_expired");
  });

  it("settles once, then returns the same job for a replay", async () => {
    const { requirements, payload } = await quoteAndSign({ description: "Settled once", budget: toUnits("0.03") });
    const before = await balanceOf(client.address);
    const first = await post("/settle", { paymentPayload: payload, paymentRequirements: requirements });
    expect(first.success).toBe(true);
    expect(first.jobId).toBeDefined();
    expect(first.txHash).toMatch(/^0x[0-9a-f]{64}$/i);
    const job = await cw.getJob(BigInt(String(first.jobId)));
    expect(job.status).toBe(JobStatus.Funded);
    expect(await balanceOf(client.address)).toBe(before - toUnits("0.03"));

    const second = await post("/settle", { paymentPayload: payload, paymentRequirements: requirements });
    expect(second.success).toBe(true);
    expect(second.jobId).toBe(first.jobId);
    expect(second.alreadySettled).toBe(true);

    const replay = await post("/verify", { paymentPayload: payload, paymentRequirements: requirements });
    expect(replay.isValid).toBe(false);
    expect(replay.invalidCode).toBe("invalid_escrow_nonce_used");
  });

  it("replays a settled job after a restart", async () => {
    const { requirements, payload } = await quoteAndSign({ description: "Restart replay", budget: toUnits("0.01") });
    const first = await post("/settle", { paymentPayload: payload, paymentRequirements: requirements });
    expect(first.success).toBe(true);

    const store2 = SettlementStore.open(dbPath);
    const app2 = buildApp({ config, store: store2 });
    await app2.ready();
    try {
      const replay = await postTo(app2, "/settle", { paymentPayload: payload, paymentRequirements: requirements });
      expect(replay.success).toBe(true);
      expect(replay.jobId).toBe(first.jobId);
      expect(replay.alreadySettled).toBe(true);
    } finally {
      await app2.close();
      store2.close();
    }
  });

  it("funds from a bare payload on /escrow/fund", async () => {
    const { payload } = await quoteAndSign({ description: "Bare payload", budget: toUnits("0.01") });
    const body = await post("/escrow/fund", payload);
    expect(body.success).toBe(true);
    expect(body.jobId).toBeDefined();
  });

  it("serves a job tree by id", async () => {
    const { requirements, payload } = await quoteAndSign({ description: "Readable job" });
    const settled = await post("/settle", { paymentPayload: payload, paymentRequirements: requirements });
    const res = await app.inject({ method: "GET", url: `/jobs/${String(settled.jobId)}` });
    const body = res.json() as Record<string, unknown>;
    expect(body.id).toBe(String(settled.jobId));
    expect((body.job as Record<string, unknown>).status).toBe(JobStatus.Funded);
    expect(Array.isArray(body.children)).toBe(true);
  });
});
