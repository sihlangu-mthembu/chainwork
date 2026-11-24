import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "@chainwork/service-kit";
import { configFor } from "./env.js";
import { demoAll, runGhosting, runInjection, runKillSwitch, runSeed, runTreeScenario, startStack, type DemoReport } from "./orchestrator.js";

const command = (process.argv[2] ?? "all").toLowerCase();
process.env.NETWORK ??= "local";
const dataDir = resolve(process.env.DATA_DIR ?? "data");
mkdirSync(dataDir, { recursive: true });

const base = configFor("deployer");
const logger = createLogger("agents", { file: resolve(dataDir, "agents.log") });

const print = (reports: DemoReport[]): void => {
  for (const report of reports) {
    logger.info("report", { ...report });
    process.stdout.write(`${report.ok ? "PASS" : "FAIL"}  ${report.scenario}  ${JSON.stringify(report.detail)}\n`);
  }
};

let reports: DemoReport[] = [];
let stack;
try {
  switch (command) {
    case "seed":
      reports = [await runSeed(base, logger)];
      break;
    case "s1":
      stack = await startStack({ badMetrics: false, dataDir });
      reports = [await runTreeScenario(stack, "S1 zero-capital tree")];
      break;
    case "s2":
      stack = await startStack({ badMetrics: true, dataDir });
      reports = [await runTreeScenario(stack, "S2 hallucinating worker, challenge, re-hire", 300_000)];
      break;
    case "s3":
      reports = [await runGhosting(base, logger)];
      break;
    case "s4":
      stack = await startStack({ badMetrics: false, dataDir });
      reports = [await runInjection(base, stack)];
      break;
    case "s5":
      stack = await startStack({ badMetrics: false, dataDir });
      reports = [await runKillSwitch(base, stack)];
      break;
    case "all":
      reports = await demoAll(dataDir);
      break;
    case "reset": {
      rmSync(resolve(dataDir), { recursive: true, force: true });
      process.stdout.write(
        `Removed ${dataDir}.\nFor a full reset, stop anvil, start it again and re-run the DeployLocal script, then demo:seed.\n`,
      );
      break;
    }
    default:
      throw new Error(`Unknown command "${command}". Use seed|s1|s2|s3|s4|s5|all|reset.`);
  }
} catch (e) {
  logger.error("cli.error", { command, error: e instanceof Error ? e.stack ?? e.message : String(e) });
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  await stack?.stop();
}

if (reports.length > 0) {
  print(reports);
  if (reports.some((r) => !r.ok)) process.exitCode = 1;
}
