/**
 * SPDX-License-Identifier: MIT
 * Where every cent of the client's payment went, as one bar, with the check that it adds up.
 */
import type { Ledger as LedgerData } from "../lib/ledger";
import { formatMoney } from "../lib/format";
import { Glyph, hueOf } from "./bits";

export function Ledger({ ledger, nameOf, onHoverJob }: { ledger: LedgerData; nameOf(a: string): string; onHoverJob(id: string | null): void }) {
  const total = ledger.funded > 0n ? ledger.funded : 1n;
  const pct = (v: bigint) => Number((v * 10_000n) / total) / 100;
  return (
    <section className="ledger" aria-label="Where every cent went">
      <div className="ledger-head">
        <h2>Where the {formatMoney(ledger.funded)} tUSD8 went</h2>
        <span className={ledger.balanced ? "ledger-check" : "ledger-check is-off"}>
          {ledger.balanced ? "Every cent accounted for" : `${formatMoney(ledger.accounted)} of ${formatMoney(ledger.funded)} traced`}
        </span>
      </div>
      <div className="ledger-bar" role="img" aria-label={ledger.parts.map((p) => `${p.to === "escrow" ? "still in escrow" : nameOf(p.to)} ${formatMoney(p.amount)}`).join(", ")}>
        {ledger.parts.map((p) => (
          <span
            key={`${p.kind}:${p.to}`}
            className={p.kind === "held" ? "ledger-seg is-held" : "ledger-seg"}
            style={{ flexGrow: pct(p.amount), background: p.kind === "held" ? undefined : p.kind === "refunded" ? "#8aa0c4" : hueOf(p.to, nameOf(p.to)) }}
            title={`${p.to === "escrow" ? "Still in escrow" : nameOf(p.to)}: ${formatMoney(p.amount)} tUSD8`}
          />
        ))}
      </div>
      <ul className="ledger-list">
        {ledger.parts.map((p) => (
          <li
            key={`${p.kind}:${p.to}`}
            onMouseEnter={() => onHoverJob(p.jobs[0]?.toString() ?? null)}
            onMouseLeave={() => onHoverJob(null)}
          >
            <span className="ledger-swatch" style={{ background: p.kind === "held" ? "#3a4b69" : p.kind === "refunded" ? "#8aa0c4" : hueOf(p.to, nameOf(p.to)) }} />
            {p.kind === "held" ? <span /> : <Glyph address={p.to} name={nameOf(p.to)} size={18} />}
            <span>
              {p.kind === "held" ? "Still held in escrow" : p.kind === "refunded" ? `Refunded to ${nameOf(p.to)}` : `Paid to ${nameOf(p.to)}`}
              <span className="muted"> {p.jobs.map((j) => `#${j}`).join(" ")}</span>
            </span>
            <span className="ledger-amount">{formatMoney(p.amount)}</span>
          </li>
        ))}
      </ul>
      {ledger.stakes.length > 0 ? (
        <p className="ledger-note">
          Not the client's money:{" "}
          {ledger.stakes
            .map((s) => (s.kind === "slashed" ? `a ${formatMoney(s.amount)} bond slashed on #${s.job} went to ${nameOf(s.to)}` : `a ${formatMoney(s.amount)} challenge stake on #${s.job} went to ${nameOf(s.to)}`))
            .join("; ")}
          .
        </p>
      ) : null}
    </section>
  );
}
