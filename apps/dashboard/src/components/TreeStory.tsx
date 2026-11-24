/**
 * SPDX-License-Identifier: MIT
 * The opening view: pick a job tree, read what happened in one paragraph, see where every cent
 * went, watch the money map (live, or replayed step by step from the chain's own history), and
 * follow the plain-English timeline. Everything is read from the escrow (calls and logs).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { JobNode } from "@chainwork/types";
import { useConfig } from "../ConfigContext";
import { useNow } from "../NowContext";
import { useTree } from "../hooks";
import { useBlockTimes, useEscrowEvents, useRootJobs } from "../flowHooks";
import { describe, jobsOf, type RawEvent, type TimelineEntry } from "../lib/events";
import { explorerTxUrl, formatMoney, formatTimestamp, shortAddress } from "../lib/format";
import { ledgerOf } from "../lib/ledger";
import { flowOf, treeAt } from "../lib/replay";
import { challengeDeadline, windowLabel } from "../lib/state";
import { nameFor } from "../lib/wallets";
import { flattenTree } from "../lib/tree";
import { FlowMap, type Pulse } from "./FlowMap";
import { Ledger } from "./Ledger";
import { ReplayBar } from "./ReplayBar";
import { Stamp, jobTitle } from "./Ticket";
import { CopyButton, Glyph, Toasts, type Toast } from "./bits";
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

/** Amounts in gold, the rest plain. */
function withMoney(line: string): ReactNode[] {
  return line.split(/(\d+\.\d+ tUSD8)/).map((part, i) => (/^\d+\.\d+ tUSD8$/.test(part) ? <span key={i} className="money">{part}</span> : part));
}

function readHash(): { job: bigint | null; step: number | null } {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const job = params.get("job");
  const step = params.get("step");
  return { job: job && /^\d+$/.test(job) ? BigInt(job) : null, step: step && /^\d+$/.test(step) ? Number(step) - 1 : null };
}

const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Events worth a toast when they happen while you watch. */
const TOAST_EVENTS = new Set(["JobCreated", "Challenged", "JobRejected", "JobExpired", "TreeSettled"]);

const chainOrder = (x: RawEvent, y: RawEvent): number =>
  x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1;

export function TreeStory() {
  const { config } = useConfig();
  const wallNow = useNow();
  const { roots, error: rootsError } = useRootJobs(40);
  const initial = useMemo(readHash, []);
  const [rootId, setRootId] = useState<bigint | null>(initial.job);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(initial.step);
  const [playing, setPlaying] = useState(false);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const activeRoot = rootId ?? roots[0]?.job.id ?? null;
  const { tree, error } = useTree(activeRoot);
  const { events, error: eventsError, truncatedBefore } = useEscrowEvents();

  const nameOf = useMemo(
    () => (a: string) => nameFor(a, config.chainId, config.clientAccount) ?? shortAddress(a, 4),
    [config.chainId, config.clientAccount],
  );

  // This tree's events in chain order; `shown` are the ones with a plain-English line.
  const ids = useMemo(() => new Set(tree ? flattenTree(tree).map((n) => n.job.id) : []), [tree]);
  const treeEvents = useMemo<RawEvent[]>(() => events.filter((e) => jobsOf(e).some((id) => ids.has(id))).sort(chainOrder), [events, ids]);
  const shown = useMemo(() => {
    const out: { e: TimelineEntry; i: number }[] = [];
    treeEvents.forEach((ev, i) => {
      const e = describe(ev, nameOf);
      if (e) out.push({ e, i });
    });
    return out;
  }, [treeEvents, nameOf]);
  const lines = useMemo(() => shown.map((x) => x.e), [shown]);
  const times = useBlockTimes(useMemo(() => treeEvents.map((t) => t.blockNumber), [treeEvents]));

  // Replay: `step` indexes `shown`; null means live (the read views, which are the current truth).
  const head = shown.length - 1;
  const live = step === null || step >= head;
  const at = live ? head : Math.max(0, step);
  const rawAt = shown[at]?.i ?? treeEvents.length - 1;
  const display = useMemo(() => (tree && !live ? treeAt(tree, treeEvents, rawAt) : tree), [tree, live, treeEvents, rawAt]);
  const stepTime = !live ? times.get(treeEvents[rawAt]?.blockNumber.toString() ?? "") : undefined;
  const now = stepTime ?? wallNow;
  const ledger = useMemo(
    () => (tree ? ledgerOf(tree.job.id, tree.job.budget, live ? treeEvents : treeEvents.slice(0, rawAt + 1)) : null),
    [tree, treeEvents, live, rawAt],
  );

  // Coins along the line for the step just shown (replay) or the events that just arrived (live).
  const pulse = useCallback(
    (evs: RawEvent[]) => {
      if (!tree) return;
      const stamp = Date.now();
      const fresh: Pulse[] = [];
      for (const e of evs) {
        const f = flowOf(e, tree.job.id);
        if (f) fresh.push({ key: `${e.txHash}:${e.logIndex}:${stamp}`, flow: f });
      }
      if (fresh.length === 0) return;
      setPulses((p) => [...p.slice(-6), ...fresh]);
      window.setTimeout(() => setPulses((p) => p.filter((x) => !fresh.includes(x))), 1900);
    },
    [tree],
  );
  const lastShown = useRef<number>(-1);
  useEffect(() => {
    if (live) {
      lastShown.current = treeEvents.length - 1;
      return;
    }
    const prev = lastShown.current;
    lastShown.current = rawAt;
    if (rawAt > prev && rawAt - prev <= 4) pulse(treeEvents.slice(prev + 1, rawAt + 1));
  }, [rawAt, live, treeEvents, pulse]);

  // Live: coins and toasts for events that arrive after the first scan.
  const seen = useRef<number | null>(null);
  const parentOf = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const e of events) if (e.eventName === "SubJobCreated") m.set(String(e.args.childId), BigInt(String(e.args.parentId)));
    return m;
  }, [events]);
  useEffect(() => {
    if (seen.current === null) {
      if (events.length > 0) seen.current = events.length;
      return;
    }
    if (events.length <= seen.current) return;
    const fresh = events.slice(seen.current);
    seen.current = events.length;
    if (live) pulse(fresh.filter((e) => jobsOf(e).some((id) => ids.has(id))));
    // Toasts only for what the timeline in view doesn't already show you: a new tree starting
    // elsewhere, and the moments that matter on this one (a challenge, a refusal, a settlement).
    const notes: Toast[] = [];
    for (const e of fresh) {
      if (!TOAST_EVENTS.has(e.eventName)) continue;
      const job = jobsOf(e)[0] ?? 0n;
      const root = parentOf.get(job.toString()) ?? job;
      const here = ids.has(job) || root === activeRoot;
      if (here && !["Challenged", "JobRejected", "TreeSettled", "JobExpired"].includes(e.eventName)) continue;
      if (!here && !(e.eventName === "JobCreated" && !parentOf.has(job.toString()))) continue;
      const entry = describe(e, nameOf);
      if (!entry) continue;
      notes.push({
        id: entry.key,
        text: here ? entry.text : `A new job tree started: #${job}`,
        tone: entry.tone,
        ...(here ? {} : { action: { label: `Open #${job}`, run: () => setRootId(job) } }),
      });
    }
    if (notes.length) setToasts((t) => [...t, ...notes].slice(-3));
  }, [events, live, ids, nameOf, parentOf, activeRoot, pulse]);

  // Play: one step every 0.9 s, then hand back to live at the end.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setStep((s) => {
        const cur = s === null ? -1 : s;
        if (cur + 1 >= head) {
          setPlaying(false);
          return null;
        }
        return cur + 1;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [playing, head]);

  // Once someone starts replaying, keep their tree on screen even if a newer one starts.
  const pin = useCallback(() => {
    if (rootId === null && activeRoot !== null) setRootId(activeRoot);
  }, [rootId, activeRoot]);

  const play = useCallback(() => {
    pin();
    if (playing) {
      setPlaying(false);
      return;
    }
    if (live) {
      lastShown.current = -1;
      setStep(0);
    }
    setPlaying(true);
  }, [playing, live, pin]);
  const goLive = useCallback(() => {
    setPlaying(false);
    setStep(null);
  }, []);
  const goStep = useCallback(
    (i: number) => {
      pin();
      setPlaying(false);
      setStep(i >= head ? null : Math.max(0, i));
    },
    [head, pin],
  );

  // Switching trees resets the view.
  const prevRoot = useRef(activeRoot);
  useEffect(() => {
    if (prevRoot.current === activeRoot) return;
    prevRoot.current = activeRoot;
    setSelected(null);
    setStep(null);
    setPlaying(false);
  }, [activeRoot]);

  // Keyboard: space play, arrows step, L live, [ ] other trees. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === " " && t?.tagName !== "BUTTON") {
        ev.preventDefault();
        play();
      } else if (ev.key === "ArrowLeft") goStep(at - 1);
      else if (ev.key === "ArrowRight") goStep(at + 1);
      else if (ev.key.toLowerCase() === "l") goLive();
      else if (ev.key === "[" || ev.key === "]") {
        const i = roots.findIndex((r) => r.job.id === activeRoot);
        const next = roots[i + (ev.key === "]" ? 1 : -1)];
        if (next) setRootId(next.job.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play, goStep, goLive, at, roots, activeRoot]);

  // Deep link: #job=14&step=7 opens that tree at that step.
  useEffect(() => {
    if (activeRoot === null) return;
    const hash = `#job=${activeRoot}${live ? "" : `&step=${at + 1}`}`;
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  }, [activeRoot, live, at]);

  const railList = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = railList.current;
    if (!list) return;
    const target = live ? list.lastElementChild : list.querySelector(".is-now");
    if (target instanceof HTMLElement) list.scrollTop = target.offsetTop - list.clientHeight / 2;
  }, [shown.length, live, at]);

  const closeToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  if (config.escrow === null) return null;

  if (roots.length === 0 && !rootsError && activeRoot === null) {
    return (
      <section className="empty">
        <h2>No job trees on this escrow yet</h2>
        <p>Start the demo and the first tree appears here within seconds, live: tickets, money lines and every on-chain step.</p>
        <div className="cmd">
          <code>docker compose up --build</code>
          <CopyButton value="docker compose up --build" />
        </div>
        <p className="muted small">Or without Docker:</p>
        <div className="cmd">
          <code>KEEP_CHAIN=1 scripts/demo-local.sh all</code>
          <CopyButton value="KEEP_CHAIN=1 scripts/demo-local.sh all" />
        </div>
      </section>
    );
  }

  const focus = display ? (flattenTree(display).find((n) => n.job.id === (selected ?? display.job.id)) ?? display) : null;

  return (
    <section className="story" aria-labelledby="story-title">
      <nav className="roots" aria-label="Job trees">
        <span className="roots-label">Job trees</span>
        {roots.slice(0, 14).map((r) => {
          const ink = r.job.status === 3 ? "blue" : r.job.status === 4 || r.job.status === 5 ? "red" : "ochre";
          return (
            <button
              key={r.job.id.toString()}
              type="button"
              className={r.job.id === activeRoot ? "root-tab is-active" : "root-tab"}
              onClick={() => setRootId(r.job.id)}
              title={ink === "ochre" ? "In progress" : ink === "blue" ? "Settled" : "Refused or refunded"}
            >
              <span className={`root-dot ink-${ink}`} aria-hidden="true" />#{r.job.id.toString()}
              <span className="root-tab-sub">{formatMoney(r.job.budget)}</span>
            </button>
          );
        })}
      </nav>
      <ErrorNote message={rootsError ?? error} />

      {tree && display ? (
        <>
          <header className="story-head">
            <div>
              <h1 id="story-title">
                Job #{tree.job.id.toString()}
                <span className="story-kind">
                  {jobTitle(tree.job.description)} for {nameOf(tree.job.client)}
                </span>
              </h1>
              <div className="story-text">
                {storyOf(display, nameOf).map((line) => (
                  <p key={line}>{withMoney(line)}</p>
                ))}
              </div>
            </div>
            {ledger ? <Ledger ledger={ledger} nameOf={nameOf} onHoverJob={setHover} /> : null}
          </header>

          <div className="story-grid">
            <div>
              <div className="stage">
                <FlowMap
                  tree={display}
                  now={now}
                  nameOf={nameOf}
                  selected={focus?.job.id ?? null}
                  onSelect={setSelected}
                  hover={hover}
                  onHover={setHover}
                  pulses={pulses}
                />
                <ReplayBar
                  entries={lines}
                  step={at}
                  live={live}
                  playing={playing}
                  time={stepTime ? clock(stepTime) : null}
                  onStep={goStep}
                  onPlay={play}
                  onLive={goLive}
                />
              </div>
              {focus ? <TicketDetail node={focus} nameOf={nameOf} entries={lines} now={now} /> : null}
            </div>

            <aside className="rail" aria-label="What happened on chain">
              <div className="rail-head">
                <h2>What happened</h2>
                <span className="rail-sub">{shown.length} on-chain steps</span>
              </div>
              {eventsError ? <p className="rail-note">The event history could not be read: {eventsError}</p> : null}
              {truncatedBefore !== null ? <p className="rail-note">Showing events from block {truncatedBefore.toString()} on.</p> : null}
              <ol className="rail-list" ref={railList}>
                {lines.map((t, i) => {
                  const ts = times.get(t.block.toString());
                  const cls = [
                    "rail-item",
                    `tone-${t.tone}`,
                    !live && i > at ? "is-future" : "",
                    !live && i === at ? "is-now" : "",
                    hover === t.jobId.toString() ? "is-lit" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <li
                      key={t.key}
                      className={cls}
                      onMouseEnter={() => setHover(t.jobId.toString())}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => {
                        goStep(i);
                        setSelected(t.jobId);
                      }}
                    >
                      <span className="rail-time">{ts ? clock(ts) : `block ${t.block}`}</span>
                      <span className="rail-text">{t.text}</span>
                      {t.txHash ? (
                        <span className="rail-meta" onClick={(ev) => ev.stopPropagation()}>
                          <ExternalLink href={explorerTxUrl(config.explorerUrl, t.txHash)} title={t.txHash}>
                            <span className="hash">{shortAddress(t.txHash, 4)}</span>
                          </ExternalLink>
                          <CopyButton value={t.txHash} />
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {shown.length === 0 ? <p className="rail-note">Reading the escrow's history…</p> : null}
            </aside>
          </div>
        </>
      ) : activeRoot !== null ? (
        <p className="story-loading">Reading job #{activeRoot.toString()}…</p>
      ) : null}

      <Toasts items={toasts} onClose={closeToast} />
    </section>
  );
}

function TicketDetail({ node, nameOf, entries, now }: { node: JobNode; nameOf: (a: string) => string; entries: TimelineEntry[]; now: number }) {
  const { config } = useConfig();
  const deadline = challengeDeadline(node.ext.submittedAt, node.ext.challengeWindow);
  const mine = entries.filter((t, i, all) => t.jobId === node.job.id && all.findIndex((u) => u.jobId === node.job.id && u.txHash === t.txHash) === i);
  const zero = /^0x0+$/;
  const rows: { k: string; v: ReactNode }[] = [
    { k: "Asked for", v: jobTitle(node.job.description) },
    { k: "Provider", v: <Who a={node.job.provider} nameOf={nameOf} /> },
    { k: "Paid by", v: <Who a={node.job.client} nameOf={nameOf} /> },
    { k: "Evaluator", v: <Who a={node.job.evaluator} nameOf={nameOf} /> },
    { k: "Budget", v: `${formatMoney(node.job.budget)} tUSD8` },
    { k: "Provider's bond", v: node.ext.bond > 0n ? `${formatMoney(node.ext.bond)} tUSD8` : "None needed: its record covers it" },
  ];
  if (node.ext.paidToChildren > 0n || node.children.length > 0) rows.push({ k: "Spent on hires", v: `${formatMoney(node.ext.paidToChildren)} tUSD8` });
  rows.push({ k: "Challenge window", v: deadline === null ? "Not delivered yet" : windowLabel(deadline, now) });
  rows.push({ k: "Deadline", v: formatTimestamp(Number(node.job.expiredAt)) });
  if (!zero.test(node.ext.deliverable))
    rows.push({
      k: "Output hash",
      v: (
        <>
          <span className="hash">{shortAddress(node.ext.deliverable, 8)}</span>
          <CopyButton value={node.ext.deliverable} />
        </>
      ),
    });
  if (node.ext.challenged)
    rows.push({
      k: "Challenged by",
      v: (
        <>
          <Who a={node.ext.challenger} nameOf={nameOf} />
          <span>staking {formatMoney(node.ext.challengeBond)} tUSD8</span>
        </>
      ),
    });

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
          Transactions:
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
      <Glyph address={a} name={nameOf(a)} size={18} />
      <span>{nameOf(a)}</span>
      <AddressLink address={a} explorerUrl={config.explorerUrl} />
      <CopyButton value={a} />
    </>
  );
}
