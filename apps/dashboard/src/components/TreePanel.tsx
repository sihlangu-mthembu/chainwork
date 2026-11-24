/**
 * SPDX-License-Identifier: MIT
 * T5.2 job tree: a root id plus recent jobs, read ONLY through escrow read views (SDK readTree and
 * getJobsPage). No eth_getLogs. Polls every 1.5 s, so a new block shows up inside 2 s.
 */
import { useState } from "react";
import type { UiJobState } from "@chainwork/types";
import { useConfig } from "../ConfigContext";
import { useNow } from "../NowContext";
import { useRecentJobs, useTree } from "../hooks";
import { formatAmount, formatTimestamp, parseJobId } from "../lib/format";
import { jobStatusLabel, toneFor } from "../lib/state";
import { summarizeTree } from "../lib/tree";
import { JobNodeCard } from "./JobNodeCard";
import { Badge, ErrorNote, Notice, Panel } from "./ui";

export function TreePanel() {
  const { config } = useConfig();
  const now = useNow();
  const [rootInput, setRootInput] = useState("");
  const [rootId, setRootId] = useState<bigint | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const recent = useRecentJobs(12);
  const { tree, error, fetching, updatedAt } = useTree(rootId);
  const ready = config.escrow !== null;

  function load(idText: string): void {
    const parsed = parseJobId(idText);
    if (parsed === null) {
      setInputError("A job id is a whole number, like 1 or 42.");
      return;
    }
    setInputError(null);
    setRootInput(idText.trim());
    setRootId(parsed);
  }

  const summary = tree ? summarizeTree(tree) : null;
  const secondsAgo = updatedAt === null ? null : Math.max(0, Math.round((Date.now() - updatedAt) / 1000));

  return (
    <Panel
      title="Job tree"
      subtitle="Every node is read from the escrow's read views (eth_call). Polling every 1.5 s."
      wide
      actions={
        <span className={fetching ? "live live-on" : "live"} aria-hidden="true">
          {fetching ? "reading…" : secondsAgo === null ? "idle" : "updated " + secondsAgo.toString() + "s ago"}
        </span>
      }
    >
      {!ready ? (
        <Notice kind="warn">Set the escrow address (VITE_ESCROW or deployment.json) to read a tree.</Notice>
      ) : null}

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          load(rootInput);
        }}
      >
        <label className="field field-inline">
          <span className="field-label">Root job id</span>
          <input
            className="input mono"
            inputMode="numeric"
            placeholder="e.g. 1"
            value={rootInput}
            onChange={(event) => setRootInput(event.target.value)}
          />
        </label>
        <button className="button button-primary" type="submit" disabled={!ready}>
          Load tree
        </button>
        {inputError ? <span className="field-error">{inputError}</span> : null}
      </form>

      <ErrorNote message={error} />

      {tree && summary ? (
        <div className="tree">
          <div className="tree-head">
            <div>
              <h3>
                Root #{tree.job.id.toString()}{" "}
                <Badge tone={toneFor(tree.ui)}>{tree.ui}</Badge>
              </h3>
              <p className="muted small">
                {summary.nodes.toString()} node(s) · funded {formatAmount(summary.totalBudget)} tUSD8 · paid to children{" "}
                {formatAmount(summary.paidToChildren)} tUSD8 · deadline {formatTimestamp(Number(tree.job.expiredAt))}
              </p>
            </div>
            <div className="chips">
              {Object.entries(summary.counts).map(([state, count]) => (
                <Badge key={state} tone={toneFor(state as UiJobState)}>
                  {state} × {count}
                </Badge>
              ))}
            </div>
          </div>
          <ul className="tree-root">
            <JobNodeCard
              node={tree}
              depth={0}
              explorerUrl={config.explorerUrl}
              escrow={config.escrow ?? ""}
              now={now}
            />
          </ul>
        </div>
      ) : null}

      {!tree && rootId !== null && !error ? <p className="muted">Reading job #{rootId.toString()}…</p> : null}

      <div className="recent">
        <h3>
          Recent jobs <span className="muted small">via getJobsPage — no logs</span>
        </h3>
        {recent.error ? <Notice kind="warn">{recent.error}</Notice> : null}
        {!ready ? (
          <p className="muted small">Recent jobs need the escrow address.</p>
        ) : recent.jobs.length === 0 && !recent.error ? (
          <p className="muted small">No jobs on this escrow yet. Run the demo seed (T4.3) and they will appear.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Budget
                  </th>
                  <th scope="col">Provider</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {[...recent.jobs].reverse().map((job, index) => {
                  const ext = recent.exts[recent.jobs.length - 1 - index];
                  return (
                    <tr key={job.id.toString()}>
                      <td className="mono">#{job.id.toString()}</td>
                      <td>
                        <Badge tone="info">{jobStatusLabel(job.status)}</Badge>
                      </td>
                      <td className="num mono">{formatAmount(job.budget)}</td>
                      <td className="mono small">{job.provider.slice(0, 10)}…</td>
                      <td>
                        <button
                          className="button button-small"
                          type="button"
                          onClick={() =>
                            load(ext && ext.parentId > 0n ? ext.parentId.toString() : job.id.toString())
                          }
                        >
                          {ext && ext.parentId > 0n ? "open parent tree" : "open tree"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}
