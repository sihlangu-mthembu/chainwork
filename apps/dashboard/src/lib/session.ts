/**
 * SPDX-License-Identifier: MIT
 * Session-key drafts for the AgentAccount controls: parse what a person types, refuse anything the
 * contract would refuse (or that would be a footgun), and describe the resulting scope in words.
 */
import { getAddress, isAddress } from "viem";
import type { Address } from "@chainwork/types";
import { formatAmount, formatTimestamp, parseAmount } from "./format";

export interface SessionDraft {
  key: Address;
  validUntil: number;
  perJobCap: bigint;
  dailyCap: bigint;
}

export type SessionDraftResult = { ok: true; draft: SessionDraft } | { ok: false; error: string };

const MIN_SECONDS = 60;
const MAX_SECONDS = 30 * 24 * 60 * 60;

/** "90s" | "30m" | "2h" | "1d" | "3600" -> seconds. Null when unparseable. */
export function parseDurationSeconds(input: string): number | null {
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(input.trim());
  if (!match) return null;
  const amountText = match[1];
  if (!amountText) return null;
  const amount = Number.parseInt(amountText, 10);
  if (!Number.isSafeInteger(amount)) return null;
  const unit = (match[2] ?? "s").toLowerCase();
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const multiplier = multipliers[unit] ?? 1;
  return amount * multiplier;
}

export interface SessionInput {
  key: string;
  duration: string;
  perJobCap: string;
  dailyCap: string;
  nowSeconds: number;
}

export function buildSessionDraft(input: SessionInput): SessionDraftResult {
  const fail = (error: string): SessionDraftResult => ({ ok: false, error });
  const keyText = input.key.trim();
  if (!isAddress(keyText)) return fail("Enter the session key's address (0x…).");
  const seconds = parseDurationSeconds(input.duration);
  if (seconds === null) return fail("Expiry must look like 90s, 30m, 2h or 1d.");
  if (seconds < MIN_SECONDS) return fail("Give the key at least 60 seconds, or it expires before it can be used.");
  if (seconds > MAX_SECONDS) return fail("Keep sessions under 30 days; re-issue a fresh key instead.");
  const perJobCap = parseAmount(input.perJobCap);
  if (perJobCap === null) return fail("Per-job cap must be an amount in tUSD8, like 0.05.");
  if (perJobCap <= 0n) return fail("The per-job cap must be above zero, or every funding attempt fails.");
  const dailyCap = parseAmount(input.dailyCap);
  if (dailyCap === null) return fail("Daily cap must be an amount in tUSD8, like 0.20.");
  if (dailyCap <= 0n) return fail("The daily cap must be above zero.");
  if (dailyCap < perJobCap) return fail("The daily cap can't be smaller than the per-job cap.");
  return {
    ok: true,
    draft: {
      key: getAddress(keyText),
      validUntil: Math.floor(input.nowSeconds) + seconds,
      perJobCap,
      dailyCap,
    },
  };
}

/** "Active until 2026-11-24 14:30 UTC · 0.05 tUSD8 per job · 0.20 tUSD8 per day". */
export function describeSession(
  session: { validUntil: number; perJobCap: bigint; dailyCap: bigint },
  nowSeconds: number,
): string {
  const state = session.validUntil > nowSeconds ? "Active until " : "Expired at ";
  return (
    state +
    formatTimestamp(session.validUntil) +
    " · " +
    formatAmount(session.perJobCap) +
    " tUSD8 per job · " +
    formatAmount(session.dailyCap) +
    " tUSD8 per day"
  );
}

/** For the UI's note: revocation is checked when the next funding signature is verified. */
export const REVOKE_NOTE =
  "Revoking a key takes effect on the next funding attempt: the account refuses the signature, so no new job can start with it. Jobs already funded are unaffected.";
