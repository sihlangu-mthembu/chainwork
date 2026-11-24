// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { JobStatus } from "@chainwork/types";
import {
  UI_STATES,
  challengeDeadline,
  isTerminalState,
  jobStatusLabel,
  secondsLeft,
  toneFor,
  windowLabel,
} from "./state";

describe("ui state presentation", () => {
  it("has a tone for every UI state", () => {
    for (const state of UI_STATES) {
      expect(["neutral", "info", "warn", "bad", "good"]).toContain(toneFor(state));
    }
  });

  it("marks challenged and rejected as bad, settled as good", () => {
    expect(toneFor("Challenged")).toBe("bad");
    expect(toneFor("Rejected")).toBe("bad");
    expect(toneFor("Settled")).toBe("good");
    expect(toneFor("Submitted")).toBe("warn");
  });

  it("knows the terminal states", () => {
    expect(isTerminalState("Settled")).toBe(true);
    expect(isTerminalState("Refunded")).toBe(true);
    expect(isTerminalState("Submitted")).toBe(false);
  });

  it("covers all ten UiJobState values", () => {
    expect(UI_STATES).toHaveLength(10);
    expect(new Set(UI_STATES).size).toBe(10);
  });
});

describe("challenge window maths", () => {
  it("computes the deadline from submittedAt + window", () => {
    expect(challengeDeadline(1000n, 60n)).toBe(1060);
  });

  it("returns null when there is no window or no submission", () => {
    expect(challengeDeadline(1000n, 0n)).toBeNull();
    expect(challengeDeadline(0n, 60n)).toBeNull();
  });

  it("counts down and never goes negative", () => {
    expect(secondsLeft(1060, 1000)).toBe(60);
    expect(secondsLeft(1060, 1060)).toBe(0);
    expect(secondsLeft(1060, 2000)).toBe(0);
  });

  it("labels the window", () => {
    expect(windowLabel(null, 1000)).toBe("");
    expect(windowLabel(1060, 1000)).toBe("Window closes in 60s");
    expect(windowLabel(1060, 2000)).toBe("Window closed");
  });
});

describe("jobStatusLabel", () => {
  it("names every IERC8183 status", () => {
    expect(jobStatusLabel(JobStatus.Open)).toBe("Open");
    expect(jobStatusLabel(JobStatus.Submitted)).toBe("Submitted");
    expect(jobStatusLabel(JobStatus.Expired)).toBe("Expired");
  });
});
