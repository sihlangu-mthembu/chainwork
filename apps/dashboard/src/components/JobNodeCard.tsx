/**
 * SPDX-License-Identifier: MIT
 * One job in the tree: UiJobState badge, the money on the node, its challenge countdown and the
 * explorer links we actually have (tx hashes come from receipts, the indexer or this tab's writes).
 */
import { useSyncExternalStore } from "react";
import type { Hex, JobNode } from "@chainwork/types";
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatAmount,
  formatTimestamp,
  shortAddress,
} from "../lib/format";
import { challengeDeadline, secondsLeft, toneFor, windowLabel } from "../lib/state";
import { subscribeTxs, txHashesFor, txVersion } from "../lib/txStore";
import { AddressLink, Badge, ExternalLink } from "./ui";

function useTxHashes(jobId: string): readonly Hex[] {
  useSyncExternalStore(subscribeTxs, txVersion);
  return txHashesFor(jobId);
}

export function JobNodeCard({
  node,
  depth,
  explorerUrl,
  escrow,
  now,
}: {
  node: JobNode;
  depth: number;
  explorerUrl: string;
  escrow: string;
  now: number;
}) {
  const hashes = useTxHashes(node.job.id.toString());
  const deadline = challengeDeadline(node.ext.submittedAt, node.ext.challengeWindow);
  const left = deadline === null ? null : secondsLeft(deadline, now);
  const children = node.children;

  return (
    <li className="node">
      <article className={"node-card" + (depth === 0 ? " node-card-root" : "")}>
        <header className="node-head">
          <span className="job-id mono">#{node.job.id.toString()}</span>
          <Badge tone={toneFor(node.ui)}>{node.ui}</Badge>
          {depth === 0 ? <Badge tone="info">root</Badge> : null}
          {left !== null && left > 0 ? <Badge tone="warn">{left.toString()}s to challenge</Badge> : null}
          {node.ext.depth > 0 ? <span className="muted small">depth {node.ext.depth.toString()}</span> : null}
        </header>

        <div className="node-grid">
          <div>
            <span className="k">Budget</span>
            <span className="v mono">{formatAmount(node.job.budget)} tUSD8</span>
          </div>
          <div>
            <span className="k">Bond posted</span>
            <span className="v mono">{formatAmount(node.ext.bond)} tUSD8</span>
          </div>
          <div>
            <span className="k">Provider</span>
            <span className="v">
              <AddressLink address={node.job.provider} explorerUrl={explorerUrl} />
            </span>
          </div>
          <div>
            <span className="k">Client</span>
            <span className="v">
              <AddressLink address={node.job.client} explorerUrl={explorerUrl} />
            </span>
          </div>
          <div>
            <span className="k">Evaluator</span>
            <span className="v">
              <AddressLink address={node.job.evaluator} explorerUrl={explorerUrl} />
            </span>
          </div>
          <div>
            <span className="k">Paid to children</span>
            <span className="v mono">{formatAmount(node.ext.paidToChildren)} tUSD8</span>
          </div>
          <div>
            <span className="k">Open children</span>
            <span className="v mono">{node.ext.openChildren.toString()}</span>
          </div>
          <div>
            <span className="k">Deadline</span>
            <span className="v mono">{formatTimestamp(Number(node.job.expiredAt))}</span>
          </div>
        </div>

        {deadline !== null ? (
          <p className={"window " + (left !== null && left > 0 ? "window-open" : "window-closed")}>
            {windowLabel(deadline, now)}
            <span className="muted small">
              {" "}
              · submitted {formatTimestamp(Number(node.ext.submittedAt))} · window{" "}
              {node.ext.challengeWindow.toString()}s
            </span>
          </p>
        ) : (
          <p className="muted small">No challenge window: the evaluator decides.</p>
        )}

        {node.ext.challenged ? (
          <p className="window window-open">
            Challenged by <span className="mono">{shortAddress(node.ext.challenger, 4)}</span> with a{" "}
            {formatAmount(node.ext.challengeBond)} tUSD8 bond.
          </p>
        ) : null}

        <footer className="node-foot">
          <ExternalLink href={explorerAddressUrl(explorerUrl, escrow)}>escrow contract</ExternalLink>
          {hashes.map((hash) => (
            <ExternalLink key={hash} href={explorerTxUrl(explorerUrl, hash)}>
              tx {shortAddress(hash, 5)}
            </ExternalLink>
          ))}
          {hashes.length === 0 ? (
            <span className="muted small">no tx hash yet: build a receipt (or set VITE_INDEXER_URL) to link one</span>
          ) : null}
        </footer>
      </article>

      {children.length > 0 ? (
        <ul className="node-children">
          {children.map((child) => (
            <JobNodeCard
              key={child.job.id.toString()}
              node={child}
              depth={depth + 1}
              explorerUrl={explorerUrl}
              escrow={escrow}
              now={now}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
