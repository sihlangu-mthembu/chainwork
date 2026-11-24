/**
 * SPDX-License-Identifier: MIT
 * A job as a work ticket: number, what was asked, who holds it, the money on it, and a rubber
 * stamp for where it stands. The stamp is the one loud element on the page.
 */
import { forwardRef } from "react";
import type { JobNode, UiJobState } from "@chainwork/types";
import { formatMoney } from "../lib/format";
import { challengeDeadline, secondsLeft } from "../lib/state";
import { Glyph } from "./bits";

export const STAMP_TEXT: Record<UiJobState, string> = {
  Quoted: "Quoted",
  Escrowed: "Funded",
  Accepted: "Working",
  Subcontracted: "Hiring",
  Submitted: "In review",
  Challenged: "Challenged",
  Verified: "Verified",
  Settled: "Paid",
  Rejected: "Rejected",
  Refunded: "Refunded",
};

export type StampInk = "blue" | "red" | "ochre" | "pencil";

export function inkFor(state: UiJobState): StampInk {
  if (state === "Settled" || state === "Verified") return "blue";
  if (state === "Rejected" || state === "Challenged") return "red";
  if (state === "Submitted") return "ochre";
  return "pencil";
}

/** What the job asked for, from its JSON spec; falls back to the raw description. */
export function jobTitle(description: string): string {
  try {
    const spec = JSON.parse(description) as { kind?: string };
    if (spec.kind === "dataset") return "Transfer dataset";
    if (spec.kind === "metrics") return "Risk metrics";
    if (spec.kind === "pack") return "Analysis pack";
  } catch {
    // not JSON
  }
  const text = description.trim();
  return text.length > 48 ? `${text.slice(0, 46)}…` : text || "Untitled job";
}

/** A small, stable tilt per job so a column of stamps doesn't look machine-set. */
const tilt = (id: bigint): number => (Number(id % 7n) - 3) * 1.6;

export function Stamp({ state, id, big = false }: { state: UiJobState; id: bigint; big?: boolean }) {
  return (
    <span
      className={`stamp stamp-${inkFor(state)}${big ? " stamp-big" : ""}`}
      style={{ transform: `rotate(${tilt(id)}deg)` }}
    >
      {STAMP_TEXT[state]}
    </span>
  );
}

interface TicketProps {
  node: JobNode;
  holder: string;
  now: number;
  selected: boolean;
  root?: boolean;
  /** Highlighted from elsewhere (a hovered timeline entry). */
  lit?: boolean;
  /** Something else is highlighted: fade back. */
  dim?: boolean;
  onSelect(): void;
  onHover?(on: boolean): void;
}

export const Ticket = forwardRef<HTMLButtonElement, TicketProps>(function Ticket(
  { node, holder, now, selected, root = false, lit = false, dim = false, onSelect, onHover },
  ref,
) {
  const deadline = challengeDeadline(node.ext.submittedAt, node.ext.challengeWindow);
  const left = deadline === null ? null : secondsLeft(deadline, now);
  const inWindow = left !== null && left > 0 && (node.ui === "Submitted" || node.ui === "Challenged");
  const cls = ["ticket", "ticket-enter", root ? "ticket-root" : "", selected ? "is-selected" : "", lit ? "is-lit" : "", dim ? "is-dim" : "", `ticket-${inkFor(node.ui)}`]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={ref}
      type="button"
      className={cls}
      onClick={onSelect}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      aria-pressed={selected}
      aria-label={`Job ${node.job.id.toString()}, ${jobTitle(node.job.description)}, ${holder}, ${STAMP_TEXT[node.ui]}`}
    >
      <span className="ticket-stub">
        <span className="ticket-no">#{node.job.id.toString()}</span>
      </span>
      <span className="ticket-body">
        <span className="ticket-title">{jobTitle(node.job.description)}</span>
        <span className="ticket-holder">
          <Glyph address={node.job.provider} name={holder} size={18} />
          {holder}
        </span>
        <span className="ticket-money">
          <span className="amount">{formatMoney(node.job.budget)}</span> tUSD8
          {node.ext.bond > 0n ? <span className="ticket-bond"> bond {formatMoney(node.ext.bond)}</span> : null}
        </span>
        {inWindow ? (
          <span className="ticket-window">
            <span className="window-bar" style={{ width: `${Math.max(0, Math.min(100, (left / Number(node.ext.challengeWindow)) * 100))}%` }} />
            <span className="window-text">{left}s to challenge</span>
          </span>
        ) : null}
      </span>
      <Stamp key={node.ui} state={node.ui} id={node.job.id} big={root} />
    </button>
  );
});
