/**
 * The complete set of money-adjacent tools an agent may call. Every one either reads chain state or
 * calls @chainwork/sdk escrow methods; none can transfer tUSD8 to an arbitrary address.
 */
import { isAddressEqual, zeroAddress, type Address } from "viem";
import type { EscrowPaymentRequirements, JobTerms } from "@chainwork/types";
import {
  buildSubTerms,
  checkQuote,
  explainError,
  readTree,
  type Chainwork,
  type ChainworkConfig,
  type FundingSignature,
} from "@chainwork/sdk";
import { payloadFromSignature, toUnits } from "@chainwork/service-kit";
import { hashText } from "@chainwork/checks";
import type { ToolSpec } from "./runtime.js";

export interface AgentToolContext {
  cfg: ChainworkConfig;
  cw: Chainwork;
  facilitatorUrl: string;
  /** Sign funding terms: a session key for an AgentAccount, or an EOA for a plain client. */
  sign(terms: JobTerms): Promise<FundingSignature>;
  /** Client address being charged (AgentAccount or EOA). */
  client: Address;
  /** Set for session-key clients: terms.hook must be this BudgetGuard. */
  hook?: Address;
  /** Subcontracts may only name these providers (prompt-injection fence). */
  allowedProviders: Address[];
  maxBudget?: bigint;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

const b64json = (header: string): unknown => JSON.parse(Buffer.from(header, "base64").toString("utf8"));

const asString = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.length === 0) throw new Error(`${name} must be a non-empty string.`);
  return v;
};

const asBigInt = (v: unknown, name: string): bigint => {
  if (typeof v !== "bigint") {
    if (typeof v !== "string" || !/^\d+$/.test(v)) throw new Error(`${name} must be a decimal integer string.`);
    return BigInt(v);
  }
  return v;
};

export function buildTools(ctx: AgentToolContext): ToolSpec[] {
  const log = ctx.log ?? (() => {});

  const getQuote: ToolSpec = {
    name: "get_quote",
    description: "Ask a worker for its 402 escrow quote for a task description.",
    inputSchema: {
      type: "object",
      required: ["url", "description"],
      properties: { url: { type: "string" }, description: { type: "string" } },
    },
    async run(args) {
      const url = asString(args.url, "url").replace(/\/$/, "");
      const description = asString(args.description, "description");
      const res = await fetch(`${url}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status !== 402) throw new Error(`Expected 402 from ${url}, got ${res.status}.`);
      const header = res.headers.get("payment-required");
      if (!header) throw new Error("The worker did not send a PAYMENT-REQUIRED header.");
      const required = b64json(header) as { accepts?: EscrowPaymentRequirements[] };
      const requirements = required.accepts?.[0];
      if (!requirements) throw new Error("The 402 quote has no accepts entry.");
      return { requirements };
    },
  };

  const hire: ToolSpec = {
    name: "hire",
    description: "Validate a 402 quote and fund the job through the facilitator.",
    inputSchema: {
      type: "object",
      required: ["url", "description", "requirements"],
      properties: { url: { type: "string" }, description: { type: "string" }, requirements: { type: "object" } },
    },
    async run(args) {
      const url = asString(args.url, "url").replace(/\/$/, "");
      const description = asString(args.description, "description");
      const requirements = args.requirements as EscrowPaymentRequirements;
      const checked = checkQuote(requirements, ctx.cfg, description, { maxBudget: ctx.maxBudget, now: Math.floor(Date.now() / 1000) });
      if (!checked.ok) {
        log("agent.quote-refused", { reason: checked.reason });
        throw new Error(checked.reason);
      }
      const terms: JobTerms = { ...checked.terms, hook: ctx.hook ?? zeroAddress };
      const sig = await ctx.sign(terms);
      const payload = payloadFromSignature(sig, description, ctx.cfg);
      const res = await fetch(`${url}/jobs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": Buffer.from(
            JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
          ).toString("base64"),
        },
        body: JSON.stringify({ description }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = (await res.json()) as { jobId?: string; error?: string };
      if (res.status !== 202 || !body.jobId) {
        log("agent.hire-refused", { status: res.status, error: body.error });
        throw new Error(body.error ?? `The worker rejected the funded job (HTTP ${res.status}).`);
      }
      log("agent.hired", { jobId: body.jobId, url });
      return { jobId: body.jobId };
    },
  };

  const subcontract: ToolSpec = {
    name: "subcontract",
    description: "Carve a child job out of a parent's escrowed budget for an allowed provider.",
    inputSchema: {
      type: "object",
      required: ["parentId", "provider", "budget", "description"],
      properties: {
        parentId: { type: "string" },
        provider: { type: "string" },
        budget: { type: "string", description: "tUSD8 base units" },
        description: { type: "string" },
      },
    },
    async run(args) {
      const parentId = asBigInt(args.parentId, "parentId");
      const provider = asString(args.provider, "provider") as Address;
      const budget = asBigInt(args.budget, "budget");
      const description = asString(args.description, "description");
      if (!ctx.allowedProviders.some((p) => p.toLowerCase() === provider.toLowerCase())) {
        log("agent.subcontract-refused", { provider });
        throw new Error("That provider is not on this agent's allowlist.");
      }
      const parent = await ctx.cw.getJob(parentId);
      const room = await ctx.cw.maxSubcontract(parentId);
      if (budget > room) throw new Error(`Subcontract budget ${budget} exceeds the ${room} available.`);
      const terms = buildSubTerms({
        provider,
        evaluator: parent.evaluator,
        budget,
        expiredAt: parent.expiredAt > 90n ? parent.expiredAt - 60n : parent.expiredAt - 10n,
        challengeWindow: 30,
      });
      const result = await ctx.cw.subcontract(parentId, terms, description);
      log("agent.subcontracted", { parentId: parentId.toString(), childId: result.childId.toString(), provider });
      return { childId: result.childId.toString() };
    },
  };

  const submit: ToolSpec = {
    name: "submit",
    description: "Submit an output string for a job the agent provides.",
    inputSchema: {
      type: "object",
      required: ["jobId", "output"],
      properties: { jobId: { type: "string" }, output: { type: "string" } },
    },
    async run(args) {
      const jobId = asBigInt(args.jobId, "jobId");
      const output = asString(args.output, "output");
      const deliverable = hashText(output);
      const tx = await ctx.cw.submit(jobId, deliverable);
      return { deliverable, txHash: tx.hash };
    },
  };

  const tree: ToolSpec = {
    name: "read_tree",
    description: "Read a job tree using the escrow read views (no event logs).",
    inputSchema: {
      type: "object",
      required: ["rootId"],
      properties: { rootId: { type: "string" } },
    },
    async run(args) {
      const rootId = asBigInt(args.rootId, "rootId");
      const node = await readTree(ctx.cw, rootId);
      const compact = (n: typeof node): unknown => ({
        id: n.job.id.toString(),
        ui: n.ui,
        budget: n.job.budget.toString(),
        provider: n.job.provider,
        client: n.job.client,
        deliverable: n.ext.deliverable,
        children: n.children.map(compact),
      });
      return compact(node);
    },
  };

  const numbers: ToolSpec = {
    name: "provider_numbers",
    description: "Read a provider's score, bond, credit limit and worst-case loss.",
    inputSchema: {
      type: "object",
      required: ["provider", "budget"],
      properties: { provider: { type: "string" }, budget: { type: "string" } },
    },
    async run(args) {
      const provider = asString(args.provider, "provider") as Address;
      const budget = asBigInt(args.budget, "budget");
      const n = await ctx.cw.providerNumbers(provider, budget);
      return {
        score: n.score.toString(),
        bondBps: n.bondBps.toString(),
        bond: n.bond.toString(),
        creditLimit: n.creditLimit.toString(),
        worstCaseLoss: n.worstCaseLoss.toString(),
      };
    },
  };

  const wait: ToolSpec = {
    name: "wait",
    description: "Wait a bounded number of seconds for deliveries or challenge windows.",
    inputSchema: {
      type: "object",
      required: ["seconds"],
      properties: { seconds: { type: "number" } },
    },
    async run(args) {
      const seconds = Math.min(Number(args.seconds), 120);
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error("seconds must be a number.");
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return { waited: seconds };
    },
  };

  void toUnits;
  void isAddressEqual;
  void explainError;
  return [getQuote, hire, subcontract, submit, tree, numbers, wait];
}
