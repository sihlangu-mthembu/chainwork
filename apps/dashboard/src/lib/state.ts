/**
 * SPDX-License-Identifier: MIT
 * Mapping on-chain job state to presentation state. The labels themselves come from the SDK
 * (uiState); this module only adds colours, countdown maths and terminality.
 */
import { JobStatus, type UiJobState } from "@chainwork/types";

export type Tone = "neutral" | "info" | "warn" | "bad" | "good";

const TONES: Record<UiJobState, Tone> = {
  Quoted: "neutral",
  Escrowed: "info",
  Accepted: "info",
  Subcontracted: "info",
  Submitted: "warn",
  Challenged: "bad",
  Verified: "good",
  Settled: "good",
  Rejected: "bad",
  Refunded: "neutral",
};

const TERMINAL: readonly UiJobState[] = ["Settled", "Rejected", "Refunded"];

/** Every state the SDK can emit, in lifecycle order (used by tests and the legend). */
export const UI_STATES: readonly UiJobState[] = [
  "Quoted",
  "Escrowed",
  "Accepted",
  "Subcontracted",
  "Submitted",
  "Challenged",
  "Verified",
  "Settled",
  "Rejected",
  "Refunded",
];

export function toneFor(state: UiJobState): Tone {
  return TONES[state];
}

export function isTerminalState(state: UiJobState): boolean {
  return TERMINAL.includes(state);
}

/** Unix seconds at which a submitted job's challenge window closes, or null when there is none. */
export function challengeDeadline(submittedAt: bigint, challengeWindow: bigint): number | null {
  if (challengeWindow <= 0n || submittedAt <= 0n) return null;
  return Number(submittedAt + challengeWindow);
}

export function secondsLeft(deadline: number, nowSeconds: number): number {
  const delta = deadline - nowSeconds;
  return delta > 0 ? Math.floor(delta) : 0;
}

export function windowOpen(deadline: number | null, nowSeconds: number): boolean {
  return deadline !== null && deadline > nowSeconds;
}

/** Human line for a node's window: "Window closes in 42s", "Window closed", or "" (no window). */
export function windowLabel(deadline: number | null, nowSeconds: number): string {
  if (deadline === null) return "";
  const left = secondsLeft(deadline, nowSeconds);
  return left > 0 ? "Window closes in " + left.toString() + "s" : "Window closed";
}

/** Plain label for the raw IERC8183 status (used by the recent-jobs list before a tree read). */
export function jobStatusLabel(status: JobStatus): string {
  const labels: Record<number, string> = {
    [JobStatus.Open]: "Open",
    [JobStatus.Funded]: "Funded",
    [JobStatus.Submitted]: "Submitted",
    [JobStatus.Completed]: "Completed",
    [JobStatus.Rejected]: "Rejected",
    [JobStatus.Expired]: "Expired",
  };
  return labels[Number(status)] ?? "Unknown";
}
