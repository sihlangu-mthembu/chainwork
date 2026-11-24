// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { buildSessionDraft, describeSession, parseDurationSeconds, REVOKE_NOTE } from "./session";

describe("parseDurationSeconds", () => {
  it("understands the short units", () => {
    expect(parseDurationSeconds("90s")).toBe(90);
    expect(parseDurationSeconds("30m")).toBe(1800);
    expect(parseDurationSeconds("2h")).toBe(7200);
    expect(parseDurationSeconds("1d")).toBe(86400);
    expect(parseDurationSeconds("3600")).toBe(3600);
    expect(parseDurationSeconds(" 15 M ")).toBe(900);
  });

  it("rejects anything else", () => {
    expect(parseDurationSeconds("soon")).toBeNull();
    expect(parseDurationSeconds("")).toBeNull();
    expect(parseDurationSeconds("-5m")).toBeNull();
    expect(parseDurationSeconds("1w")).toBeNull();
  });
});

const nowSeconds = 1_764_000_000;

describe("buildSessionDraft", () => {
  it("turns the form into contract arguments", () => {
    const result = buildSessionDraft({
      key: "0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1",
      duration: "24h",
      perJobCap: "0.05",
      dailyCap: "0.20",
      nowSeconds,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.validUntil).toBe(nowSeconds + 86400);
      expect(result.draft.perJobCap).toBe(50000n);
      expect(result.draft.dailyCap).toBe(200000n);
    }
  });

  it("refuses a bad key", () => {
    const result = buildSessionDraft({ key: "nope", duration: "1h", perJobCap: "0.05", dailyCap: "0.1", nowSeconds });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("address");
  });

  it("refuses a daily cap below the per-job cap", () => {
    const result = buildSessionDraft({
      key: "0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1",
      duration: "1h",
      perJobCap: "0.50",
      dailyCap: "0.10",
      nowSeconds,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("daily cap");
  });

  it("refuses zero caps and too-long sessions", () => {
    const zero = buildSessionDraft({
      key: "0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1",
      duration: "1h",
      perJobCap: "0",
      dailyCap: "0.1",
      nowSeconds,
    });
    expect(zero.ok).toBe(false);

    const long = buildSessionDraft({
      key: "0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1",
      duration: "60d",
      perJobCap: "0.05",
      dailyCap: "0.1",
      nowSeconds,
    });
    expect(long.ok).toBe(false);
  });

  it("refuses amounts with too many decimals", () => {
    const result = buildSessionDraft({
      key: "0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1",
      duration: "1h",
      perJobCap: "0.0000001",
      dailyCap: "0.1",
      nowSeconds,
    });
    expect(result.ok).toBe(false);
  });
});

describe("describeSession", () => {
  it("describes the scope in words", () => {
    const text = describeSession({ validUntil: nowSeconds + 3600, perJobCap: 50000n, dailyCap: 200000n }, nowSeconds);
    expect(text).toContain("Active until");
    expect(text).toContain("0.05 tUSD8 per job");
    expect(text).toContain("0.2 tUSD8 per day");
  });

  it("says expired when the clock passed", () => {
    expect(describeSession({ validUntil: nowSeconds - 1, perJobCap: 1n, dailyCap: 1n }, nowSeconds)).toContain("Expired");
  });
});

describe("revoke note", () => {
  it("explains when revocation bites", () => {
    expect(REVOKE_NOTE).toContain("next funding attempt");
  });
});
