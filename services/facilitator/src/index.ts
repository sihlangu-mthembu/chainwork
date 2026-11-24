import { resolve } from "node:path";
import { loadServiceConfig } from "@chainwork/service-kit";
import { createLogger } from "@chainwork/service-kit";
import { buildApp } from "./app.js";
import { SettlementStore } from "./settle.js";

const config = loadServiceConfig();
const logger = createLogger("facilitator");
const dataDir = resolve(process.env.DATA_DIR ?? "data");
const store = SettlementStore.open(process.env.FACILITATOR_DB ?? resolve(dataDir, "facilitator.sqlite"));
const app = buildApp({ config, store, logger });

const port = Number(process.env.PORT ?? process.env.FACILITATOR_PORT ?? 3402);
const host = process.env.HOST ?? "0.0.0.0";

const shutdown = async (signal: string) => {
  logger.info("shutdown", { signal });
  await app.close();
  store.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port, host });
logger.info("listening", { port, host, network: config.network, escrow: config.cfg.escrow });
