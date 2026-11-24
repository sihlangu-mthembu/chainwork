/**
 * HTTP surface of the facilitator. The routes follow docs/X402_ESCROW_SCHEME.md and also accept
 * the x402 v2 request envelope while the L0 alignment PR is open.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Address } from "viem";
import { chainworkFor } from "@chainwork/service-kit";
import { jsonSafe, type Logger, type ServiceConfig } from "@chainwork/service-kit";
import { normalizePayment, verifyPayment, type VerifyResult } from "./verify.js";
import { Settler, SettlementStore } from "./settle.js";

export interface AppDeps {
  config: ServiceConfig;
  store: SettlementStore;
  logger?: Logger;
}

const idParam = (req: FastifyRequest): bigint | undefined => {
  const raw = (req.params as { id?: string }).id ?? "";
  if (!/^\d+$/.test(raw)) return undefined;
  return BigInt(raw);
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, store, logger } = deps;
  const cw = chainworkFor(config);
  const settler = new Settler({ config, cw, store, logger });
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  const network = `eip155:${config.cfg.chainId}`;

  app.get("/health", async () => {
    const blockNumber = await cw.publicClient.getBlockNumber({ cacheTime: 0 });
    return {
      ok: true,
      service: "facilitator",
      network,
      chainId: config.cfg.chainId,
      blockNumber: blockNumber.toString(),
      escrow: config.cfg.escrow,
      relayer: config.relayer.address,
    };
  });

  app.get("/supported", async () => ({
    // Frozen-spec fields first, then the x402 v2 shape.
    scheme: "escrow",
    network,
    asset: config.cfg.token,
    x402Version: 2,
    kinds: [
      {
        x402Version: 2,
        scheme: "escrow",
        network,
        extra: { asset: config.cfg.token, escrow: config.cfg.escrow },
      },
    ],
    extensions: [],
    signers: { "eip155:*": [config.relayer.address] },
  }));

  app.post("/verify", async (req, reply) => {
    const normalized = normalizePayment(req.body, config.cfg);
    if (!normalized.ok) return reply.send(normalized.failure);
    try {
      const result: VerifyResult = await verifyPayment(normalized.value, { config, cw });
      return reply.send(jsonSafe(result));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger?.error("verify.error", { error: message });
      return reply.send({
        isValid: false,
        invalidReason: message,
        invalidCode: "unexpected_verify_error",
        invalidMessage: message,
      });
    }
  });

  app.post("/settle", async (req, reply) => {
    const normalized = normalizePayment(req.body, config.cfg);
    if (!normalized.ok) {
      return reply.send({
        success: false,
        network,
        errorReason: normalized.failure.invalidCode,
        errorMessage: normalized.failure.invalidReason,
      });
    }
    return reply.send(await settler.settle(normalized.value));
  });

  /** Agents hiring agents directly: no 402 round-trip, just the signed payload. */
  app.post("/escrow/fund", async (req, reply) => {
    const normalized = normalizePayment(req.body, config.cfg);
    if (!normalized.ok) {
      return reply.send({
        success: false,
        network,
        errorReason: normalized.failure.invalidCode,
        errorMessage: normalized.failure.invalidReason,
      });
    }
    return reply.send(await settler.settle(normalized.value));
  });

  app.get("/jobs/:id", async (req, reply) => {
    const id = idParam(req);
    if (id === undefined) return reply.status(400).send({ error: "The job id must be a number." });
    try {
      const [job, ext, kidIds] = await Promise.all([cw.getJob(id), cw.getJobExt(id), cw.getChildren(id)]);
      const children = await Promise.all(
        kidIds.map(async (childId) => {
          const [childJob, childExt] = await Promise.all([cw.getJob(childId), cw.getJobExt(childId)]);
          return { job: childJob, ext: childExt };
        }),
      );
      const [childrenRoot, windowRemaining] = await Promise.all([
        kidIds.length > 0 ? cw.childrenRoot(id) : Promise.resolve(null),
        cw.windowRemaining(id),
      ]);
      return reply.send(
        jsonSafe({
          id: id.toString(),
          job,
          ext,
          children,
          childrenRoot,
          windowRemaining,
          network,
          explorer: { escrow: config.explorerAddress(config.cfg.escrow as Address) },
        }),
      );
    } catch (e) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.setErrorHandler((error, _req, reply) => {
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode ?? 500;
    logger?.error("http.error", { error: err.message, status });
    return reply.status(status).send({ error: status === 400 ? "invalid_request" : "server_error", message: err.message });
  });

  return app;
}
