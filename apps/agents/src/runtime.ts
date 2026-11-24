/**
 * A tiny tool-calling runtime. The only way an agent can act on money is through a ToolSpec whose
 * implementation is an SDK escrow call; there is no "send tokens to address" tool anywhere.
 *
 * Policies: an OpenAI-compatible chat model, a recorded replay (deterministic demo), or a scripted
 * list. The runtime itself is identical in all three modes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export type AgentDecision = { call: ToolCall } | { finish: string };

export interface TraceStep {
  step: number;
  call?: ToolCall;
  result?: unknown;
  error?: string;
}

export interface PolicyInput {
  task: string;
  history: TraceStep[];
  tools: ToolSpec[];
}

export interface Policy {
  decide(input: PolicyInput): Promise<AgentDecision>;
}

export class ScriptedPolicy implements Policy {
  constructor(private readonly decisions: AgentDecision[]) {}

  async decide(): Promise<AgentDecision> {
    const next = this.decisions.shift();
    return next ?? { finish: "Script finished." };
  }
}

export class ReplayPolicy implements Policy {
  constructor(private readonly decisions: AgentDecision[]) {}

  static load(path: string): ReplayPolicy {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { decisions: AgentDecision[] };
    return new ReplayPolicy(raw.decisions);
  }

  static save(path: string, decisions: AgentDecision[]): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ decisions }, null, 2)}\n`);
  }

  async decide(): Promise<AgentDecision> {
    return this.decisions.shift() ?? { finish: "Replay finished." };
  }
}

/** Wraps a policy and records every decision for a later --replay run. */
export class RecordingPolicy implements Policy {
  readonly decisions: AgentDecision[] = [];

  constructor(private readonly inner: Policy) {}

  async decide(input: PolicyInput): Promise<AgentDecision> {
    const decision = await this.inner.decide(input);
    this.decisions.push(decision);
    return decision;
  }
}

interface ChatToolCall {
  function?: { name?: string; arguments?: string };
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatToolCall[] } }>;
}

/** OpenAI-compatible chat-completions policy. Requires LLM_BASE_URL and LLM_API_KEY. */
export class LlmPolicy implements Policy {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async decide(input: PolicyInput): Promise<AgentDecision> {
    const history = input.history
      .map((h) => (h.call ? `called ${h.call.name}(${JSON.stringify(h.call.args)}) -> ${JSON.stringify(h.result ?? h.error)}` : ""))
      .filter(Boolean)
      .join("\n");
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a Chainwork agent. Money moves only through the provided escrow tools. Never invent an address or amount outside the tools. Stop with a short summary when done.",
          },
          { role: "user", content: `${input.task}\n\nSteps so far:\n${history || "(none)"}` },
        ],
        tools: input.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as ChatResponse;
    const message = body.choices?.[0]?.message;
    const call = message?.tool_calls?.[0];
    if (call?.function?.name) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      return { call: { name: call.function.name, args } };
    }
    return { finish: message?.content ?? "Done." };
  }
}

export interface PolicyOptions {
  /** Scripted decisions used when no model and no replay file are configured. */
  scripted?: AgentDecision[];
  replayPath?: string;
  recordPath?: string;
  forceReplay?: boolean;
}

export function policyFor(opts: PolicyOptions): { policy: Policy; mode: "replay" | "llm" | "scripted"; recorder?: RecordingPolicy } {
  if (opts.replayPath && existsSync(opts.replayPath) && (opts.forceReplay || !process.env.LLM_API_KEY)) {
    return { policy: ReplayPolicy.load(opts.replayPath), mode: "replay" };
  }
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  if (base && key && !opts.forceReplay) {
    const recorder = new RecordingPolicy(new LlmPolicy(base, key, process.env.LLM_MODEL ?? "gpt-4o-mini"));
    return { policy: recorder, mode: "llm", recorder };
  }
  return { policy: new ScriptedPolicy(opts.scripted ?? []), mode: "scripted" };
}

export class AgentRuntime {
  constructor(
    private readonly tools: ToolSpec[],
    private readonly policy: Policy,
    private readonly log: (event: string, fields?: Record<string, unknown>) => void = () => {},
  ) {}

  async run(task: string, maxSteps = 12): Promise<{ summary: string; trace: TraceStep[] }> {
    const trace: TraceStep[] = [];
    for (let step = 1; step <= maxSteps; step++) {
      const decision = await this.policy.decide({ task, history: trace, tools: this.tools });
      if ("finish" in decision) {
        this.log("agent.finish", { summary: decision.finish, steps: trace.length });
        return { summary: decision.finish, trace };
      }
      const tool = this.tools.find((t) => t.name === decision.call.name);
      if (!tool) {
        trace.push({ step, call: decision.call, error: `No tool named ${decision.call.name}.` });
        this.log("agent.unknown-tool", { name: decision.call.name });
        continue;
      }
      try {
        const result = await tool.run(decision.call.args);
        trace.push({ step, call: decision.call, result });
        this.log("agent.tool", { tool: tool.name, args: decision.call.args, result });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        trace.push({ step, call: decision.call, error });
        this.log("agent.blocked", { tool: tool.name, error });
      }
    }
    return { summary: `Stopped after ${maxSteps} steps.`, trace };
  }
}
