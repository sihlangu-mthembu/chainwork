import { resolve } from "node:path";
import { chainworkFor, createLogger, loadServiceConfig, parseWorkerUrls } from "@chainwork/service-kit";
import { EvaluatorStore } from "./store.js";
import { resolveOnce } from "./evaluator.js";

process.env.AGENT_ROLE ??= "evaluator";
const config = loadServiceConfig();
const dataDir = resolve(process.env.DATA_DIR ?? "data");
const logger = createLogger("evaluator", { file: process.env.EVALUATOR_LOG ?? resolve(dataDir, "evaluator.log") });
const store = EvaluatorStore.open(resolve(dataDir, "evaluator.sqlite"));
const cw = chainworkFor(config);
const workerUrls = parseWorkerUrls(process.env.WORKER_URLS);
const pollMs = Number(process.env.POLL_MS ?? 2_000);
let stopping = false;

const loop = async () => {
  while (!stopping) {
    try {
      const result = await resolveOnce({ config, cw, store, logger, workerUrls });
      if (result.resolved > 0) logger.info("evaluator.pass", { ...result });
    } catch (e) {
      logger.error("evaluator.loop-error", { error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  store.close();
  process.exit(0);
};

process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));
logger.info("listening", { network: config.network, pollMs, evaluator: config.relayer.address });
await loop();
