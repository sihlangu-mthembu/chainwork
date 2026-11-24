// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { indexerEventsUrl, summarizeEvent } from "./indexer";

describe("indexerEventsUrl", () => {
  it("joins the base and the job id", () => {
    expect(indexerEventsUrl("http://127.0.0.1:4100/", "42")).toBe("http://127.0.0.1:4100/events?jobId=42");
    expect(indexerEventsUrl("http://127.0.0.1:4100", "4 2")).toBe("http://127.0.0.1:4100/events?jobId=4%202");
  });
});

describe("summarizeEvent", () => {
  it("reads the canonical field names", () => {
    const summary = summarizeEvent({
      event: "JobFunded",
      jobId: "7",
      txHash: "0x" + "ab".repeat(32),
      blockNumber: 1234,
      amount: "100000",
    });
    expect(summary).toEqual({
      event: "JobFunded",
      jobId: "7",
      txHash: "0x" + "ab".repeat(32),
      block: 1234,
      amount: "100000",
    });
  });

  it("accepts alternative names", () => {
    const summary = summarizeEvent({
      eventName: "PaymentReleased",
      job_id: 3,
      transactionHash: "0x" + "cd".repeat(32),
      block: "99",
      value: 500n,
    });
    expect(summary.event).toBe("PaymentReleased");
    expect(summary.jobId).toBe("3");
    expect(summary.block).toBe(99);
    expect(summary.amount).toBe("500");
  });

  it("drops a hash that is not a 32-byte hex string", () => {
    expect(summarizeEvent({ txHash: "0x1234" }).txHash).toBeNull();
  });

  it("falls back to a generic event name", () => {
    expect(summarizeEvent({}).event).toBe("event");
  });
});
