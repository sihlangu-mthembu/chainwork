import { resolve } from "node:path";
import { chainworkFor, createLogger, loadServiceConfig, localRoleAddress, toUnits } from "@chainwork/service-kit";
import { buildWorkerApp } from "./server.js";
import { WorkerStore } from "./store.js";
import { makeWork, parseWorkerUrls, type WorkKind } from "./work.js";

const role = process.env.AGENT_ROLE ?? "specialist-data";
process.env.AGENT_ROLE = role;
const config = loadServiceConfig();
const logger = createLogger(`worker-${role}`);

const defaults: Record<string, { kind: WorkKind; price: string; port: number; bad?: boolean }> = {
  "specialist-data": { kind: "dataset", price: "0.03", port: 4101 },
  "specialist-bad": { kind: "metrics", price: "0.04", port: 4102, bad: true },
  backup: { kind: "metrics", price: "0.04", port: 4103 },
  coordinator: { kind: "pack", price: "0.10", port: 4100 },
  seed: { kind: "echo", price: "0.01", port: 4104 },
};
const plan = defaults[role];
if (!plan) throw new Error(`Unknown AGENT_ROLE "${role}". Use one of: ${Object.keys(defaults).join(", ")}.`);

const port = Number(process.env.PORT ?? plan.port);
const publicUrl = process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const evaluator =
  (process.env.EVALUATOR_ADDRESS as `0x${string}` | undefined) ??
  (config.network === "local" ? localRoleAddress("evaluator") : undefined);
if (!evaluator) throw new Error("Set EVALUATOR_ADDRESS for non-local networks.");

const price = BigInt(process.env.PRICE_UNITS ?? toUnits(plan.price).toString());
const dataDir = resolve(process.env.DATA_DIR ?? "data");
const store = WorkerStore.open(resolve(dataDir, `worker-${role}.sqlite`));
const workerUrls = parseWorkerUrls(process.env.WORKER_URLS);

const app = buildWorkerApp({
  config,
  store,
  work: makeWork({ kind: plan.kind, cw: chainworkFor(config), config, logger, workerUrls, bad: plan.bad }),
  kind: plan.kind,
  price,
  evaluator,
  publicUrl,
  logger,
});

const shutdown = async (signal: string) => {
  logger.info("shutdown", { signal });
  await app.close();
  store.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
logger.info("listening", { role, port, provider: config.relayer.address, price: price.toString(), evaluator });
