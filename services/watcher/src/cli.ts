import { resolve } from "node:path";
import { chainworkFor, createLogger, loadServiceConfig, parseWorkerUrls } from "@chainwork/service-kit";
import { WatcherStore } from "./store.js";
import { watchOnce } from "./watcher.js";

process.env.AGENT_ROLE ??= "watcher";
const config = loadServiceConfig();
const logger = createLogger("watcher");
const store = WatcherStore.open(resolve(process.env.DATA_DIR ?? "data", "watcher.sqlite"));
const cw = chainworkFor(config);
const workerUrls = parseWorkerUrls(process.env.WORKER_URLS);
const pollMs = Number(process.env.POLL_MS ?? 2_000);
let stopping = false;

const loop = async () => {
  while (!stopping) {
    try {
      const result = await watchOnce({ config, cw, store, logger, workerUrls });
      if (result.checked > 0 || result.challenged > 0) logger.info("watch.pass", { ...result });
    } catch (e) {
      logger.error("watch.loop-error", { error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  store.close();
  process.exit(0);
};

process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));
logger.info("listening", { network: config.network, pollMs });
await loop();
