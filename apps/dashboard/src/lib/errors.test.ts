// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { ChainworkError } from "@chainwork/sdk";
import { FALLBACK_ERROR, errorName, toPlainError } from "./errors";

describe("toPlainError", () => {
  it("passes SDK-decoded messages through", () => {
    expect(toPlainError(new ChainworkError("Only the job's provider can do that.", "NotProvider"))).toBe(
      "Only the job's provider can do that.",
    );
  });

  it("never shows a raw revert string", () => {
    const text = toPlainError(new Error("execution reverted: WindowOpen()"));
    expect(text).not.toMatch(/revert/i);
    expect(text).not.toMatch(/WindowOpen/);
    expect(text.length).toBeGreaterThan(0);
  });

  it("never shows a bare selector", () => {
    const text = toPlainError(new Error("0x12345678"));
    expect(text).not.toContain("0x12345678");
  });

  it("explains a wallet rejection", () => {
    expect(toPlainError(new Error("User rejected the request. Version: viem@2"))).toBe(
      "You rejected the request in your wallet.",
    );
  });

  it("explains an unreachable RPC", () => {
    expect(toPlainError(new Error("fetch failed"))).toContain("Can't reach the RPC endpoint");
  });

  it("falls back for nothing at all", () => {
    expect(toPlainError(undefined)).toBe(FALLBACK_ERROR);
    expect(toPlainError(null, "custom")).toBe("custom");
  });
});

describe("errorName", () => {
  it("keeps the decoded custom error name for logs", () => {
    expect(errorName(new ChainworkError("plain text", "ClientFrozen"))).toBe("ClientFrozen");
    expect(errorName(new Error("boom"))).toBeNull();
  });
});
