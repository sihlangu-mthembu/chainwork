/**
 * SPDX-License-Identifier: MIT
 * Parsers for the struct-shaped reads (AgentAccount.sessions, BudgetGuardHook.limits,
 * IReputationRegistry.stats). viem can return structs as a tuple or a named object depending on
 * the ABI; these helpers accept either and never throw on a half-deployed contract.
 */

export interface AgentSession {
  validUntil: bigint;
  perJobCap: bigint;
  dailyCap: bigint;
  active: boolean;
}

export interface GuardLimits {
  perJob: bigint;
  perDay: bigint;
  frozen: boolean;
}

export interface AgentStats {
  completed: bigint;
  failed: bigint;
  onTime: bigint;
  valueCompleted: bigint;
  valueSlashed: bigint;
}

const asBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
};

const asBoolean = (value: unknown): boolean => value === true || value === 1 || value === 1n || value === "true";

const field = (raw: unknown, index: number, name: string): unknown => {
  if (Array.isArray(raw)) return raw[index];
  if (raw !== null && typeof raw === "object") return (raw as Record<string, unknown>)[name];
  return undefined;
};

export function parseSession(raw: unknown): AgentSession {
  return {
    validUntil: asBigInt(field(raw, 0, "validUntil")),
    perJobCap: asBigInt(field(raw, 1, "perJobCap")),
    dailyCap: asBigInt(field(raw, 2, "dailyCap")),
    active: asBoolean(field(raw, 3, "active")),
  };
}

export function parseLimits(raw: unknown): GuardLimits {
  return {
    perJob: asBigInt(field(raw, 0, "perJob")),
    perDay: asBigInt(field(raw, 1, "perDay")),
    frozen: asBoolean(field(raw, 2, "frozen")),
  };
}

export function parseStats(raw: unknown): AgentStats {
  return {
    completed: asBigInt(field(raw, 0, "completed")),
    failed: asBigInt(field(raw, 1, "failed")),
    onTime: asBigInt(field(raw, 2, "onTime")),
    valueCompleted: asBigInt(field(raw, 3, "valueCompleted")),
    valueSlashed: asBigInt(field(raw, 4, "valueSlashed")),
  };
}

/** A session is usable when it exists, is in the future and was not revoked. */
export function sessionStatus(session: AgentSession, nowSeconds: number): "active" | "expired" | "revoked" {
  if (!session.active) return "revoked";
  return session.validUntil > BigInt(Math.floor(nowSeconds)) ? "active" : "expired";
}
