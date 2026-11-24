/**
 * SPDX-License-Identifier: MIT
 * One place that turns anything thrown by viem, wagmi, the SDK or fetch into a sentence a person
 * can read. Raw revert strings and hex blobs never reach the screen.
 */
import { ChainworkError, explainError } from "@chainwork/sdk";

const RAW_PATTERNS = [
  /execution reverted/i,
  /\breverted\b/i,
  /VM Exception/i,
  /\b0x[0-9a-fA-F]{8}\b/,
  /\breturned no data\b/i,
  /CALL_EXCEPTION/i,
];

const USER_REJECTED = /user rejected|user denied|rejected the request|4001/i;

export const FALLBACK_ERROR = "Something went wrong. Please try again.";

/** Plain-English message for any error. Never returns a revert string or a hex selector. */
export function toPlainError(err: unknown, fallback: string = FALLBACK_ERROR): string {
  if (err === null || err === undefined) return fallback;
  const explained: ChainworkError = explainError(err);
  const message = explained.message.trim();
  if (!message) return fallback;
  if (USER_REJECTED.test(message)) return "You rejected the request in your wallet.";
  for (const pattern of RAW_PATTERNS) {
    if (pattern.test(message)) {
      return explained.errorName
        ? explained.message
        : "The chain rejected that request, so nothing was sent. Check the job state and try again.";
    }
  }
  if (/failed to fetch|fetch failed|network ?error|ECONNREFUSED|timeout|timed out/i.test(message)) {
    return "Can't reach the RPC endpoint. Check the connection (and that the wallet is on Aevum).";
  }
  if (message.length > 300) return fallback;
  return message;
}

/** The custom error name behind a revert, when the SDK could decode one (handy for logs). */
export function errorName(err: unknown): string | null {
  const explained = explainError(err);
  return explained.errorName ?? null;
}
