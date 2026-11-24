/**
 * SPDX-License-Identifier: MIT
 * T5.6 BudgetGuardHook controls: per-job / per-day caps and the kill switch. Limits are keyed by
 * the calling client, so writes apply to the connected wallet — connect the client to change them.
 */
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import type { Address } from "@chainwork/types";
import { useAccount, useWriteContract } from "wagmi";
import { useConfig } from "../ConfigContext";
import { useBudgetGuard } from "../hooks";
import { budgetGuardHookAbi } from "../lib/abi";
import { formatAmount, parseAmount, shortAddress } from "../lib/format";
import { AddressLink, Badge, ErrorNote, Field, KeyValue, Notice } from "./ui";
import { useTxWriter } from "./useTxWriter";

export function BudgetGuardControls() {
  const { config } = useConfig();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const writer = useTxWriter();

  const [clientInput, setClientInput] = useState(config.clientAccount ?? "");
  const [perJob, setPerJob] = useState("");
  const [perDay, setPerDay] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const guard = config.budgetGuard;
  const subject: Address | null = isAddress(clientInput) ? getAddress(clientInput) : null;
  const connected = address === undefined ? null : getAddress(address);
  const { snapshot, error: readError } = useBudgetGuard(subject);
  const canWrite = guard !== null && subject !== null && connected !== null && connected === subject;

  async function setLimits(): Promise<void> {
    if (!guard) return;
    const jobCap = perJob.trim() === "" ? null : parseAmount(perJob);
    const dayCap = perDay.trim() === "" ? null : parseAmount(perDay);
    if (jobCap === null || dayCap === null) {
      setFormError("Enter both caps in tUSD8 (0 means no limit), e.g. 0.10 and 0.50.");
      return;
    }
    if (dayCap > 0n && jobCap > dayCap) {
      setFormError("The per-job cap can't be larger than the per-day cap.");
      return;
    }
    setFormError(null);
    await writer.run("Limits set", () =>
      writeContractAsync({
        address: guard,
        abi: budgetGuardHookAbi,
        functionName: "setLimits",
        args: [jobCap, dayCap],
      }),
    );
  }

  async function freeze(frozen: boolean): Promise<void> {
    if (!guard) return;
    await writer.run(frozen ? "Budget guard frozen" : "Budget guard unfrozen", () =>
      writeContractAsync({
        address: guard,
        abi: budgetGuardHookAbi,
        functionName: "setFrozen",
        args: [frozen],
      }),
    );
  }

  return (
    <div className="control-block">
      <h3>
        BudgetGuardHook <span className="muted small">caps + kill switch</span>
      </h3>

      <div className="inline-form">
        <Field label="Client whose limits to read" hint="VITE_CLIENT_ACCOUNT by default">
          <input
            className="input mono"
            value={clientInput}
            onChange={(event) => setClientInput(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
          />
        </Field>
        {address ? (
          <button className="button button-small" type="button" onClick={() => setClientInput(address)}>
            use connected
          </button>
        ) : null}
      </div>

      {guard === null ? (
        <Notice kind="warn">Set the budget guard address (VITE_BUDGET_GUARD or deployment.json) to read its limits.</Notice>
      ) : (
        <p className="muted small">
          Hook <AddressLink address={guard} explorerUrl={config.explorerUrl} />
        </p>
      )}

      <ErrorNote message={readError} />

      {snapshot ? (
        <KeyValue
          items={[
            { label: "Per-job cap", value: snapshot.limits.perJob === 0n ? "no limit" : formatAmount(snapshot.limits.perJob) + " tUSD8" },
            { label: "Per-day cap", value: snapshot.limits.perDay === 0n ? "no limit" : formatAmount(snapshot.limits.perDay) + " tUSD8" },
            { label: "Spent today", value: formatAmount(snapshot.spentToday) + " tUSD8" },
            {
              label: "Kill switch",
              value: snapshot.limits.frozen ? <Badge tone="bad">frozen — funding reverts</Badge> : <Badge tone="good">open</Badge>,
            },
          ]}
        />
      ) : null}

      <div className="control-form">
        <h4>Set today&apos;s limits</h4>
        <div className="grid-3">
          <Field label="Per-job cap (tUSD8)" hint="0 = no limit">
            <input
              className="input mono"
              value={perJob}
              onChange={(event) => setPerJob(event.target.value)}
              placeholder={snapshot ? formatAmount(snapshot.limits.perJob) : "0.10"}
            />
          </Field>
          <Field label="Per-day cap (tUSD8)" hint="0 = no limit">
            <input
              className="input mono"
              value={perDay}
              onChange={(event) => setPerDay(event.target.value)}
              placeholder={snapshot ? formatAmount(snapshot.limits.perDay) : "0.50"}
            />
          </Field>
        </div>
        {formError ? <Notice kind="warn">{formError}</Notice> : null}
        <div className="button-row">
          <button className="button button-primary" type="button" disabled={!canWrite || writer.pending} onClick={() => void setLimits()}>
            {writer.pending ? "Sending…" : "Set limits"}
          </button>
          <button
            className="button button-danger"
            type="button"
            disabled={!canWrite || writer.pending}
            onClick={() => void freeze(snapshot ? !snapshot.limits.frozen : true)}
          >
            {snapshot?.limits.frozen ? "Unfreeze funding" : "Freeze funding"}
          </button>
        </div>
        {!canWrite ? (
          <p className="muted small">
            setLimits applies to the calling wallet
            {connected !== null ? " (" + shortAddress(connected, 4) + ")" : ""}. Connect the client wallet to write its
            limits.
          </p>
        ) : null}
        {writer.hash ? (
          <p className="muted small mono">
            tx{" "}
            <a className="link" href={config.explorerUrl + "/tx/" + writer.hash} target="_blank" rel="noreferrer">
              {shortAddress(writer.hash, 6)}
            </a>
          </p>
        ) : null}
        <ErrorNote message={writer.error} />
        {writer.message ? <Notice kind={writer.confirmed ? "good" : "info"}>{writer.message}</Notice> : null}
      </div>
    </div>
  );
}
