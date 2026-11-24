/**
 * SPDX-License-Identifier: MIT
 * The opening view: pick a job tree, read what happened in one paragraph, see the money map,
 * and follow the on-chain timeline. Everything is read from the escrow (calls and logs).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { JobNode } from "@chainwork/types";
import { useConfig } from "../ConfigContext";
import { useNow } from "../NowContext";
import { useTree } from "../hooks";
import { useBlockTimes, useEscrowEvents, useRootJobs } from "../flowHooks";
import { byChainOrder, describe, jobsOf, type TimelineEntry } from "../lib/events";
import { explorerTxUrl, formatMoney, formatTimestamp, shortAddress } from "../lib/format";
import { challengeDeadline, windowLabel } from "../lib/state";
import { nameFor } from "../lib/wallets";
import { flattenTree } from "../lib/tree";
import { FlowMap } from "./FlowMap";
import { Stamp, jobTitle } from "./Ticket";
import { AddressLink, ErrorNote, ExternalLink } from "./ui";

const sum = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);

/** One paragraph a judge can read aloud: who paid, who was hired, what it cost the hirer. */
export function storyOf(tree: JobNode, nameOf: (a: string) => string): string[] {
  const client = nameOf(tree.job.client);
  const provider = nameOf(tree.job.provider);
  const hires = tree.children;
  const paid = hires.filter((c) => c.ui === "Settled");
  const refused = hires.filter((c) => c.ui === "Rejected" || c.ui === "Refunded");
  const lines = [`${client} put ${formatMoney(tree.job.budget)} tUSD8 into escrow for job #${tree.job.id}, payable to ${provider} on delivery.`];
  if (hires.length > 0) {
    const own = tree.ext.bond > 0n ? `after posting a ${formatMoney(tree.ext.bond)} tUSD8 bond of its own` : "without putting up any money of its own";
    lines.push(
      `${provider} hired ${hires.length} agent${hires.length === 1 ? "" : "s"} out of that escrow ${own}${paid.length > 0 ? `, and ${paid.length === hires.length ? "paid them" : `paid ${paid.length} of them`} ${formatMoney(sum(paid.map((c) => c.job.budget)))} tUSD8` : ""}.`,
    );
  }
  if (refused.length > 0) {
    lines.push(
      `${refused.length === 1 ? "One hire" : `${refused.length} hires`} failed the check and ${refused.length === 1 ? "was" : "were"} refused; the money went back to the job and a replacement was hired.`,
    );
  }
  if (tree.ui === "Settled") {
    lines.push(`Delivered and settled: ${paid.length + 1} payment${paid.length === 0 ? "" : "s"} released, nobody paid for work that failed.`);
  } else if (tree.ui === "Submitted" || tree.ui === "Challenged") {
    lines.push("The result is in; its challenge window is still open.");
  } else if (tree.ui === "Refunded") {
    lines.push("Nobody delivered in time, so the client got its money back.");
  } else if (tree.ui === "Rejected") {
    lines.push("The result was rejected; the client's money was not released.");
  } else {
    lines.push("Work is in progress.");
  }
  return lines;
}

export function TreeStory() {
  const { config } = useConfig();
  const now = useNow();
  const { roots, error: rootsError } = useRootJobs(40);
  const [rootId, setRootId] = useState<bigint | null>(null);
  const [selected, setSelected] = useState<bigint | null>(null);
  const activeRoot = rootId ?? roots[0]?.job.id ?? null;
  const { tree, error } = useTree(activeRoot);
  const { events, error: eventsError, truncatedBefore } = useEscrowEvents();

  const nameOf = useMemo(
    () => (a: string) => nameFor(a, config.chainId, config.clientAccount) ?? shortAddress(a, 4),
    [config.chainId, config.clientAccount],
  );

  const ids = useMemo(() => new Set(tree ? flattenTree(tree).map((n) => n.job.id) : []), [tree]);
  const timeline = useMemo<TimelineEntry[]>(() => {
    if (ids.size === 0) return [];
    const out: TimelineEntry[] = [];
    for (const e of events) {
      if (!jobsOf(e).some((id) => ids.has(id))) continue;
      const entry = describe(e, nameOf);
      if (entry) out.push(entry);
    }
    return out.sort(byChainOrder);
  }, [events, ids, nameOf]);
  const times = useBlockTimes(useMemo(() => timeline.map((t) => t.block), [timeline]));

  const railEnd = useRef<HTMLLIElement>(null);
  useEffect(() => {
    railEnd.current?.scrollIntoView({ block: "nearest" });
  }, [timeline.length]);

  useEffect(() => setSelected(null), [activeRoot]);
  const focus = tree ? (flattenTree(tree).find((n) => n.job.id === (selected ?? tree.job.id)) ?? tree) : null;

  if (config.escrow === null) return null;

  return (
    <section className="story" aria-labelledby="story-title">
      <nav className="roots" aria-label="Job trees">
        <span className="roots-label">Job trees</span>
        {roots.length === 0 ? <span className="roots-empty">None yet. Run the demo and the first tree appears here.</span> : null}
        {roots.slice(0, 12).map((r) => (
          <button
            key={r.job.id.toString()}
            type="button"
            className={r.job.id === activeRoot ? "root-tab is-active" : "root-tab"}
            onClick={() => setRootId(r.job.id)}
          >
            #{r.job.id.toString()}
            <span className="root-tab-sub">{formatMoney(r.job.budget)}</span>
          </button>
        ))}
      </nav>
      <ErrorNote message={rootsError ?? error} />

      {tree ? (
        <>
          <header className="story-head">
            <h1 id="story-title">
              Job #{tree.job.id.toString()} <span className="story-kind">{jobTitle(tree.job.description)}</span>
            </h1>
            <div className="story-text">
              {storyOf(tree, nameOf).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </header>

          <div className="story-grid">
            <div className="story-map">
              <FlowMap tree={tree} now={now} nameOf={nameOf} selected={focus?.job.id ?? null} onSelect={setSelected} />
              {focus ? <TicketDetail node={focus} nameOf={nameOf} timeline={timeline} now={now} /> : null}
            </div>

            <aside className="rail" aria-label="What happened on chain">
              <h2>What happened</h2>
              {eventsError ? <p className="rail-note">The event history could not be read: {eventsError}</p> : null}
              {truncatedBefore !== null ? <p className="rail-note">Showing events from block {truncatedBefore.toString()} on.</p> : null}
              <ol className="rail-list">
                {timeline.map((t) => {
                  const at = times.get(t.block.toString());
                  return (
                    <li key={t.key} className={`rail-item tone-${t.tone}`}>
                      <span className="rail-time">{at ? new Date(at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }) : `block ${t.block}`}</span>
                      <span className="rail-text">{t.text}</span>
                      {t.txHash ? (
                        <ExternalLink href={explorerTxUrl(config.explorerUrl, t.txHash)} title={t.txHash}>
                          <span className="rail-tx">{shortAddress(t.txHash, 4)}</span>
                        </ExternalLink>
                      ) : null}
                    </li>
                  );
                })}
                <li ref={railEnd} className="rail-end" aria-hidden="true" />
              </ol>
              {timeline.length === 0 ? <p className="rail-note">Reading the escrow's history…</p> : null}
            </aside>
          </div>
        </>
      ) : activeRoot !== null ? (
        <p className="story-loading">Reading job #{activeRoot.toString()}…</p>
      ) : null}
    </section>
  );
}

function TicketDetail({
  node,
  nameOf,
  timeline,
  now,
}: {
  node: JobNode;
  nameOf: (a: string) => string;
  timeline: TimelineEntry[];
  now: number;
}) {
  const { config } = useConfig();
  const deadline = challengeDeadline(node.ext.submittedAt, node.ext.challengeWindow);
  const mine = timeline.filter((t, i, all) => t.jobId === node.job.id && all.findIndex((u) => u.jobId === node.job.id && u.txHash === t.txHash) === i);
  const zero = /^0x0+$/;
  const rows: { k: string; v: React.ReactNode }[] = [
    { k: "Asked for", v: jobTitle(node.job.description) },
    { k: "Provider", v: <Who a={node.job.provider} nameOf={nameOf} /> },
    { k: "Paid by", v: <Who a={node.job.client} nameOf={nameOf} /> },
    { k: "Evaluator", v: <Who a={node.job.evaluator} nameOf={nameOf} /> },
    { k: "Budget", v: `${formatMoney(node.job.budget)} tUSD8` },
    { k: "Provider's bond", v: node.ext.bond > 0n ? `${formatMoney(node.ext.bond)} tUSD8` : "None needed (reputation covers it)" },
  ];
  if (node.ext.paidToChildren > 0n || node.children.length > 0) rows.push({ k: "Spent on hires", v: `${formatMoney(node.ext.paidToChildren)} tUSD8` });
  rows.push({ k: "Challenge window", v: deadline === null ? "Not delivered yet" : windowLabel(deadline, now) });
  rows.push({ k: "Deadline", v: formatTimestamp(Number(node.job.expiredAt)) });
  if (!zero.test(node.ext.deliverable)) rows.push({ k: "Delivered output hash", v: <span className="hash">{shortAddress(node.ext.deliverable, 8)}</span> });
  if (node.ext.challenged) rows.push({ k: "Challenged by", v: <><Who a={node.ext.challenger} nameOf={nameOf} />, staking {formatMoney(node.ext.challengeBond)} tUSD8</> });

  return (
    <div className="detail">
      <div className="detail-head">
        <h2>Ticket #{node.job.id.toString()}</h2>
        <Stamp key={node.ui} state={node.ui} id={node.job.id} />
      </div>
      <dl className="detail-list">
        {rows.map((r) => (
          <div key={r.k}>
            <dt>{r.k}</dt>
            <dd>{r.v}</dd>
          </div>
        ))}
      </dl>
      {mine.length > 0 ? (
        <p className="detail-txs">
          Transactions:{" "}
          {mine.map((t) => (
            <ExternalLink key={t.key} href={explorerTxUrl(config.explorerUrl, t.txHash)} title={t.text}>
              <span className="hash">{shortAddress(t.txHash, 4)}</span>
            </ExternalLink>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function Who({ a, nameOf }: { a: string; nameOf: (a: string) => string }) {
  const { config } = useConfig();
  return (
    <>
      {nameOf(a)} <AddressLink address={a} explorerUrl={config.explorerUrl} />
    </>
  );
}
