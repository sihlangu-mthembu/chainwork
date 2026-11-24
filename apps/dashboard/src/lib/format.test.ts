// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatAmount,
  formatAmountRounded,
  formatAmountWithUnit,
  formatBps,
  formatCountdown,
  formatDuration,
  formatTimestamp,
  parseAmount,
  parseJobId,
  shortAddress,
} from "./format";

describe("formatAmount", () => {
  it("renders base units with six decimals", () => {
    expect(formatAmount(0n)).toBe("0");
    expect(formatAmount(100000n)).toBe("0.1");
    expect(formatAmount(1000000n)).toBe("1");
    expect(formatAmount(1234567n)).toBe("1.234567");
    expect(formatAmount(1234567n, 6)).toBe("1.234567");
  });

  it("keeps negative amounts readable", () => {
    expect(formatAmount(-100000n)).toBe("-0.1");
  });

  it("has a unit suffix helper", () => {
    expect(formatAmountWithUnit(100000n)).toBe("0.1 tUSD8");
  });
});

describe("formatAmountRounded", () => {
  it("truncates long gas-token fractions", () => {
    expect(formatAmountRounded(1234567890000000000n, 18)).toBe("1.2345");
    expect(formatAmountRounded(1000000000000000000n, 18)).toBe("1");
    expect(formatAmountRounded(0n, 18)).toBe("0");
  });
});

describe("parseAmount", () => {
  it("accepts plain tUSD8 amounts", () => {
    expect(parseAmount("0.10")).toBe(100000n);
    expect(parseAmount("1")).toBe(1000000n);
    expect(parseAmount("0.000001")).toBe(1n);
    expect(parseAmount(" 0.5 ")).toBe(500000n);
  });

  it("rejects junk instead of throwing", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-1")).toBeNull();
    expect(parseAmount("0.1234567")).toBeNull();
    expect(parseAmount("1.2.3")).toBeNull();
  });
});

describe("shortAddress", () => {
  it("shortens an address with both ends visible", () => {
    expect(shortAddress("0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1", 4)).toBe("0x583B…54A1");
    expect(shortAddress("0xabc")).toBe("0xabc");
  });
});

describe("explorer urls", () => {
  it("joins without doubling slashes", () => {
    expect(explorerAddressUrl("https://explorer-test.qday.info/", "0xabc")).toBe(
      "https://explorer-test.qday.info/address/0xabc",
    );
    expect(explorerTxUrl("https://explorer-test.qday.info", "0xdef")).toBe(
      "https://explorer-test.qday.info/tx/0xdef",
    );
  });
});

describe("durations", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(65)).toBe("1m 05s");
    expect(formatDuration(3725)).toBe("1h 02m");
    expect(formatDuration(-5)).toBe("0s");
  });

  it("has countdown wording", () => {
    expect(formatCountdown(42)).toBe("42s left");
    expect(formatCountdown(0)).toBe("closed");
  });
});

describe("basis points", () => {
  it("prints percentages", () => {
    expect(formatBps(5000n)).toBe("50%");
    expect(formatBps(250n)).toBe("2.5%");
    expect(formatBps(3n)).toBe("0.03%");
    expect(formatBps(10000n)).toBe("100%");
  });
});

describe("formatTimestamp", () => {
  it("stamps UTC without depending on the host locale", () => {
    const unix = Date.UTC(2026, 10, 24, 12, 30, 0) / 1000;
    expect(formatTimestamp(unix)).toBe("2026-11-24 12:30 UTC");
    expect(formatTimestamp(0)).toBe("—");
  });
});

describe("parseJobId", () => {
  it("accepts whole numbers only", () => {
    expect(parseJobId("12")).toBe(12n);
    expect(parseJobId("0")).toBe(0n);
    expect(parseJobId("-1")).toBeNull();
    expect(parseJobId("1.5")).toBeNull();
    expect(parseJobId("")).toBeNull();
  });
});
