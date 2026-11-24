// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseLimits, parseSession, parseStats, sessionStatus } from "./contracts";

describe("parseSession", () => {
  it("reads viem's tuple form", () => {
    const session = parseSession([7200n, 50000n, 200000n, true]);
    expect(session).toEqual({ validUntil: 7200n, perJobCap: 50000n, dailyCap: 200000n, active: true });
  });

  it("reads a named object", () => {
    const session = parseSession({ validUntil: 7200n, perJobCap: 1n, dailyCap: 2n, active: false });
    expect(session.active).toBe(false);
    expect(session.perJobCap).toBe(1n);
  });

  it("survives a half-deployed contract", () => {
    expect(parseSession(undefined)).toEqual({ validUntil: 0n, perJobCap: 0n, dailyCap: 0n, active: false });
    expect(parseSession(["nonsense"])).toEqual({ validUntil: 0n, perJobCap: 0n, dailyCap: 0n, active: false });
  });
});

describe("parseLimits", () => {
  it("reads both shapes", () => {
    expect(parseLimits([100n, 500n, true])).toEqual({ perJob: 100n, perDay: 500n, frozen: true });
    expect(parseLimits({ perJob: 100n, perDay: 500n, frozen: false })).toEqual({
      perJob: 100n,
      perDay: 500n,
      frozen: false,
    });
  });
});

describe("parseStats", () => {
  it("reads the five counters", () => {
    expect(parseStats([5n, 1n, 4n, 123n, 45n])).toEqual({
      completed: 5n,
      failed: 1n,
      onTime: 4n,
      valueCompleted: 123n,
      valueSlashed: 45n,
    });
  });
});

describe("sessionStatus", () => {
  const now = 1000;

  it("is active while live and not revoked", () => {
    expect(sessionStatus({ validUntil: 2000n, perJobCap: 1n, dailyCap: 1n, active: true }, now)).toBe("active");
  });

  it("is expired after validUntil", () => {
    expect(sessionStatus({ validUntil: 999n, perJobCap: 1n, dailyCap: 1n, active: true }, now)).toBe("expired");
  });

  it("is revoked when the account says so", () => {
    expect(sessionStatus({ validUntil: 2000n, perJobCap: 1n, dailyCap: 1n, active: false }, now)).toBe("revoked");
  });
});
