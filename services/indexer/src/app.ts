import Fastify, { type FastifyInstance } from "fastify";
import type { ServiceConfig } from "@chainwork/service-kit";
import type { IndexerStore } from "./store.js";

export interface IndexerAppDeps {
  config: ServiceConfig;
  store: IndexerStore;
}

export function buildIndexerApp(deps: IndexerAppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const { store, config } = deps;

  app.get("/health", async () => ({ ok: true, service: "indexer", network: `eip155:${config.cfg.chainId}` }));

  app.get("/status", async () => ({
    cursor: store.cursor().toString(),
    events: store.count(),
  }));

  app.get("/events", async (req, reply) => {
    const q = req.query as { jobId?: string; address?: string; limit?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 100), 1), 500);
    if (q.jobId !== undefined) {
      if (!/^\d+$/.test(q.jobId)) return reply.status(400).send({ error: "jobId must be a number." });
      return { jobId: q.jobId, events: store.byJob(q.jobId, limit).map(withArgs) };
    }
    if (q.address !== undefined) {
      return { address: q.address, events: store.byAddress(q.address, limit).map(withArgs) };
    }
    return reply.status(400).send({ error: "Pass ?jobId= or ?address=." });
  });

  return app;
}

const withArgs = (row: { args: string }): Record<string, unknown> => {
  try {
    return { ...row, args: JSON.parse(row.args) as unknown };
  } catch {
    return { ...row };
  }
};
