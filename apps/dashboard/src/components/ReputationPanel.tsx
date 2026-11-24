/**
 * SPDX-License-Identifier: MIT
 * T5.3 reputation panel: score, bond rate, required bond for a budget, credit limit, getSummary and
 * the raw stats for any address. History comes from the optional indexer (GET /events?jobId=).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAddress, isAddress } from "viem";
import type { Address } from "@chainwork/types";
import { useConfig } from "../ConfigContext";
import { useReputation } from "../hooks";
import { formatAmount, formatBps, formatTimestamp, parseAmount, parseJobId } from "../lib/format";
import { fetchJobEvents } from "../lib/indexer";
import { recordTx } from "../lib/txStore";
import { toPlainError } from "../lib/errors";
import { COORDINATOR } from "../lib/wallets";
import { AddressLink, Badge, ErrorNote, Field, Notice, Panel, Stat, TxLinks } from "./ui";

export function ReputationPanel() {
  const { config } = useConfig();
  const [agentInput, setAgentInput] = useState<string>(COORDINATOR);
  const [budgetInput, setBudgetInput] = useState("0.10");
  const [historyInput, setHistoryInput] = useState("");

  const agent: Address | null = useMemo(
    () => (isAddress(agentInput) ? getAddress(agentInput) : null),
    [agentInput],
  );
  const budget = useMemo(() => parseAmount(budgetInput) ?? 0n, [budgetInput]);
  const { numbers, error, fetching } = useReputation(agent, budget);

  const indexer = config.indexerUrl;
  const historyJobId = parseJobId(historyInput);
  const history = useQuery({
    queryKey: ["indexer-events", indexer, historyJobId === null ? "none" : historyJobId.toString()],
    enabled: indexer !== null && historyJobId !== null,
    retry: 1,
    queryFn: async () => (indexer !== null && historyJobId !== null ? fetchJobEvents(indexer, historyJobId.toString()) : []),
  });

  const events = history.data ?? [];
  useEffect(() => {
    for (const event of events) {
      if (event.jobId !== null && event.txHash !== null) recordTx(event.jobId, event.txHash);
    }
  }, [events]);

  const historyError = history.error ? toPlainError(history.error) : null;
  const budgetValid = parseAmount(budgetInput) !== null;

  return (
    <Panel
      title="Reputation"
      subtitle="Bond and credit are derived from settled on-chain outcomes. Nothing here is self-reported."
      actions={<span className="live">{fetching ? "reading…" : "chain"}</span>}
    >
      <div className="inline-form">
        <Field label="Agent address">
          <input
            className="input mono"
            value={agentInput}
            onChange={(event) => setAgentInput(event.target.value)}
            spellCheck={false}
          />
        </Field>
        <Field label="Budget for requiredBond (tUSD8)">
          <input
            className="input mono"
            value={budgetInput}
            onChange={(event) => setBudgetInput(event.target.value)}
            inputMode="decimal"
          />
        </Field>
      </div>
      {!budgetValid ? <Notice kind="warn">Budget must be a tUSD8 amount, like 0.10.</Notice> : null}
      {agentInput.trim() !== "" && agent === null ? (
        <Notice kind="warn">That doesn&apos;t look like an address (0x + 40 hex characters).</Notice>
      ) : null}

      {config.reputation === null ? (
        <Notice kind="warn">Set the reputation registry address (VITE_REPUTATION or deployment.json) to read scores.</Notice>
      ) : null}

      <ErrorNote message={error} />

      {numbers === null ? (
        <p className="muted">
          {config.reputation === null
            ? "No registry configured yet."
            : agent === null
              ? "Pick a valid address to read its numbers."
              : "Reading the registry…"}
        </p>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Score" value={formatBps(numbers.score)} hint={numbers.score.toString() + " / 10000"} />
            <Stat label="Bond rate" value={formatBps(numbers.bondBps)} hint="of the job budget" />
            <Stat
              label="Required bond"
              value={formatAmount(numbers.requiredBond) + " tUSD8"}
              hint={"for a " + formatAmount(budget) + " tUSD8 job"}
            />
            <Stat label="Credit limit" value={formatAmount(numbers.creditLimit) + " tUSD8"} hint="subcontract headroom" />
            <Stat
              label="Settled jobs"
              value={numbers.summaryCount.toString()}
              hint={"average score " + numbers.averageScore.toString() + "/100"}
            />
            <Stat
              label="On time"
              value={numbers.stats.onTime.toString() + " / " + numbers.stats.completed.toString()}
              hint="completed before deadline"
            />
            <Stat label="Value completed" value={formatAmount(numbers.stats.valueCompleted) + " tUSD8"} />
            <Stat label="Bond slashed" value={formatAmount(numbers.stats.valueSlashed) + " tUSD8"} />
          </div>
          <p className="muted small">
            Failed jobs: {numbers.stats.failed.toString()} ·{" "}
            <AddressLink address={agentInput} explorerUrl={config.explorerUrl} full />
          </p>
        </>
      )}

      <div className="history">
        <h3>History</h3>
        {indexer === null ? (
          <Notice kind="info">
            The indexer is optional: without <code>VITE_INDEXER_URL</code> the dashboard shows only what it can read
            from the chain itself. Run <code>services/indexer</code> (T3.2) and set the URL to see per-job events here.
          </Notice>
        ) : (
          <>
            <div className="inline-form">
              <Field label="Job id for GET /events?jobId=">
                <input
                  className="input mono"
                  inputMode="numeric"
                  value={historyInput}
                  onChange={(event) => setHistoryInput(event.target.value)}
                  placeholder="e.g. 1"
                />
              </Field>
              <button
                className="button"
                type="button"
                disabled={historyJobId === null}
                onClick={() => void history.refetch()}
              >
                {history.isFetching ? "Loading…" : "Load events"}
              </button>
            </div>
            <ErrorNote message={historyError} />
            {events.length > 0 ? (
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Job</th>
                      <th scope="col">Block</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event, index) => (
                      <tr key={(event.txHash ?? "") + index.toString()}>
                        <td>
                          <Badge tone="info">{event.event}</Badge>
                        </td>
                        <td className="mono">{event.jobId ?? "—"}</td>
                        <td className="mono">{event.block === null ? "—" : event.block.toString()}</td>
                        <td className="mono">{event.amount === null ? "—" : event.amount}</td>
                        <td>
                          <TxLinks hashes={event.txHash === null ? [] : [event.txHash]} explorerUrl={config.explorerUrl} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">
                {historyJobId === null ? "Enter a job id to ask the indexer for its events." : "No events returned for that job."}
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
