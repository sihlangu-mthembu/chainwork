/**
 * Structured JSON-line logging. One line per event so `docker compose logs` and the demo video are
 * readable, plus an optional append-only file (the evaluator writes evaluator.log).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { jsonSafe } from "./json.js";

export interface Logger {
  /** Written only when LOG_LEVEL=debug. */
  debug?(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(service: string, opts: { file?: string } = {}): Logger {
  const write = (level: "debug" | "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify(
      jsonSafe({
        t: new Date().toISOString(),
        level,
        service,
        event,
        ...(fields ?? {}),
      }),
    );
    if (level === "error") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
    if (opts.file) {
      mkdirSync(dirname(opts.file), { recursive: true });
      appendFileSync(opts.file, `${line}\n`);
    }
  };
  const debugOn = (process.env.LOG_LEVEL ?? "").toLowerCase() === "debug";
  return {
    debug: (event, fields) => {
      if (debugOn) write("debug", event, fields);
    },
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}
