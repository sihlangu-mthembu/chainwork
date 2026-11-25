import { describe, expect, it } from "vitest";
import { hookAllowed } from "../src/server.js";

describe("R3: workers refuse hooks that could block delivery", () => {
  const guard = "0x610178dA211FEF7D417bC0e6FeD39F05609AD788";
  it("accepts no hook and the deployment's BudgetGuardHook", () => {
    expect(hookAllowed("0x0000000000000000000000000000000000000000", guard)).toBe(true);
    expect(hookAllowed(guard.toLowerCase(), guard)).toBe(true);
  });
  it("refuses any other hook unless explicitly allowed", () => {
    const evil = "0x000000000000000000000000000000000000bad1";
    expect(hookAllowed(evil, guard)).toBe(false);
    process.env.WORKER_ALLOWED_HOOKS = evil;
    expect(hookAllowed(evil, guard)).toBe(true);
    delete process.env.WORKER_ALLOWED_HOOKS;
  });
});
