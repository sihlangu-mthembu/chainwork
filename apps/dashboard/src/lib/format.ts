/**
 * SPDX-License-Identifier: MIT
 * Formatting helpers for every dashboard panel. Pure functions: no chain access, no React.
 */
import { TUSD8 } from "@chainwork/types";

export const TOKEN_DECIMALS = TUSD8.decimals;

const trimZeros = (fraction: string): string => fraction.replace(/0+$/, "");

/** Base units (6 decimals) to a human number: 100000n -> "0.1", 1000000n -> "1". */
export function formatAmount(units: bigint, decimals: number = TOKEN_DECIMALS): string {
  const negative = units < 0n;
  const value = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const fractionText =
    fraction === 0n ? "" : "." + trimZeros(fraction.toString().padStart(decimals, "0"));
  return (negative ? "-" : "") + whole.toString() + fractionText;
}

/** Money with at least two decimals, like a price: 100000n -> "0.10", 12000n -> "0.012". */
export function formatMoney(units: bigint, decimals: number = TOKEN_DECIMALS): string {
  const text = formatAmount(units, decimals);
  const [whole, fraction = ""] = text.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/** 100000n -> "0.10 tUSD8" (keeps the demo's cents visible). */
export function formatAmountWithUnit(units: bigint, symbol = "tUSD8"): string {
  return formatAmount(units) + " " + symbol;
}

/** Strict user input parsing. Returns null instead of throwing so forms can show a message. */
export function parseAmount(input: string, decimals: number = TOKEN_DECIMALS): bigint | null {
  const text = input.trim().replace(/_/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const parts = text.split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** 0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1 -> 0x583B…54A1 */
export function shortAddress(value: string, size = 4): string {
  const text = value.trim();
  if (size <= 0 || text.length <= size * 2 + 4) return text;
  return text.slice(0, 2 + size) + "…" + text.slice(-size);
}

const trimSlash = (base: string): string => base.replace(/\/+$/, "");

export function explorerAddressUrl(explorerUrl: string, address: string): string {
  return trimSlash(explorerUrl) + "/address/" + address;
}

export function explorerTxUrl(explorerUrl: string, hash: string): string {
  return trimSlash(explorerUrl) + "/tx/" + hash;
}

export function explorerBlockUrl(explorerUrl: string, block: bigint | number): string {
  return trimSlash(explorerUrl) + "/block/" + block.toString();
}

/** 42 -> "42s", 65 -> "1m 05s", 3725 -> "1h 02m". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return seconds.toString() + "s";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return minutes.toString() + "m " + rest.toString().padStart(2, "0") + "s";
  const hours = Math.floor(minutes / 60);
  return hours.toString() + "h " + (minutes % 60).toString().padStart(2, "0") + "m";
}

/** Countdown wording for a challenge window. */
export function formatCountdown(secondsLeft: number): string {
  return secondsLeft > 0 ? formatDuration(secondsLeft) + " left" : "closed";
}

/** 5000n -> "50%", 250n -> "2.5%", 3n -> "0.03%". */
export function formatBps(bps: bigint): string {
  const whole = bps / 100n;
  const fraction = bps % 100n;
  const fractionText = fraction === 0n ? "" : "." + trimZeros(fraction.toString().padStart(2, "0"));
  return whole.toString() + fractionText + "%";
}

/** Unix seconds to a compact UTC stamp: 1764000000 -> "2026-11-24 12:30 UTC". */
export function formatTimestamp(unixSeconds: number): string {
  if (unixSeconds <= 0) return "—";
  const iso = new Date(unixSeconds * 1000).toISOString();
  return iso.slice(0, 10) + " " + iso.slice(11, 16) + " UTC";
}

/** Integer input ("12") to bigint, or null. */
export function parseJobId(input: string): bigint | null {
  const text = input.trim();
  if (!/^\d+$/.test(text)) return null;
  return BigInt(text);
}

/** Truncating formatter for gas-token balances: 1234567890000000000n -> "1.2345" (18 decimals). */
export function formatAmountRounded(units: bigint, decimals: number, maxFractionDigits = 4): string {
  const text = formatAmount(units, decimals);
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const parts = body.split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  if (fraction.length === 0) return text;
  const cut = fraction.slice(0, Math.max(0, maxFractionDigits));
  return (negative ? "-" : "") + whole + (cut.length > 0 ? "." + cut : "");
}
