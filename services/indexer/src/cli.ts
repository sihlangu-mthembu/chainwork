import { resolve } from "node:path";
import { createLogger, loadServiceConfig } from "@chainwork/service-kit";
import { buildIndexerApp } from "./app.js";
import { indexOnce } from "./indexer.js";
import { IndexerStore } from "./store.js";

const config = loadServiceConfig({ readOnly: true });
const logger = createLogger("indexer");
const store = IndexerStore.open(resolve(process.env.DATA_DIR ?? "data", "indexer.sqlite"));
const app = buildIndexerApp({ config, store });
const pollMs = Number(process.env.POLL_MS ?? 2_000);
const chunk = Number(process.env.LOG_CHUNK ?? 500);
let stopping = false;

const loop = async () => {
  while (!stopping) {
    try {
      const pass = await indexOnce({ config, store, logger, chunk });
      if (pass.inserted > 0) logger.info("indexer.pass", { ...pass, from: pass.from.toString(), to: pass.to.toString(), latest: pass.latest.toString() });
    } catch (e) {
      logger.error("indexer.loop-error", { error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  await app.close();
  store.close();
  process.exit(0);
};

process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

await app.listen({ port: Number(process.env.PORT ?? 3403), host: process.env.HOST ?? "0.0.0.0" });
logger.info("listening", { network: config.network, chunk, pollMs });
await loop();
