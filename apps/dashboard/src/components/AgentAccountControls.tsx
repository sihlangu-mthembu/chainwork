/**
 * SPDX-License-Identifier: MIT
 * T5.6 AgentAccount controls: read owner/frozen/sessions for a key, then add or revoke a scoped
 * session and freeze the account — owner-only writes through wagmi's useWriteContract.
 */
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import type { Address } from "@chainwork/types";
import { useAccount, useWriteContract } from "wagmi";
import { useConfig } from "../ConfigContext";
import { useNow } from "../NowContext";
import { useAgentAccount } from "../hooks";
import { agentAccountAbi } from "../lib/abi";
import { sessionStatus } from "../lib/contracts";
import { formatAmount, formatTimestamp, shortAddress } from "../lib/format";
import { buildSessionDraft, describeSession, REVOKE_NOTE } from "../lib/session";
import { AddressLink, Badge, ErrorNote, Field, KeyValue, Notice } from "./ui";
import { useTxWriter } from "./useTxWriter";

export function AgentAccountControls() {
  const { config } = useConfig();
  const now = useNow();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const writer = useTxWriter();

  const [accountInput, setAccountInput] = useState(config.clientAccount ?? "");
  const [keyInput, setKeyInput] = useState("");
  const [duration, setDuration] = useState("24h");
  const [perJobCap, setPerJobCap] = useState("0.05");
  const [dailyCap, setDailyCap] = useState("0.20");
  const [draftError, setDraftError] = useState<string | null>(null);

  const account: Address | null = isAddress(accountInput) ? getAddress(accountInput) : null;
  const key: Address | null = isAddress(keyInput) ? getAddress(keyInput) : null;
  const { snapshot, error: readError } = useAgentAccount(account, key);

  const connected = address === undefined ? null : getAddress(address);
  const isOwner = snapshot !== null && connected !== null && connected === getAddress(snapshot.owner);
  const canWrite = account !== null && isOwner;

  async function addSession(): Promise<void> {
    if (!account) return;
    const result = buildSessionDraft({
      key: keyInput,
      duration,
      perJobCap,
      dailyCap,
      nowSeconds: now,
    });
    if (!result.ok) {
      setDraftError(result.error);
      return;
    }
    setDraftError(null);
    const draft = result.draft;
    await writer.run("Session added", () =>
      writeContractAsync({
        address: account,
        abi: agentAccountAbi,
        functionName: "addSession",
        args: [draft.key, BigInt(draft.validUntil), draft.perJobCap, draft.dailyCap],
      }),
    );
  }

  async function revoke(): Promise<void> {
    if (!account || !key) return;
    await writer.run("Session revoked", () =>
      writeContractAsync({
        address: account,
        abi: agentAccountAbi,
        functionName: "revokeSession",
        args: [key],
      }),
    );
  }

  async function freeze(frozen: boolean): Promise<void> {
    if (!account) return;
    await writer.run(frozen ? "Account frozen" : "Account unfrozen", () =>
      writeContractAsync({
        address: account,
        abi: agentAccountAbi,
        functionName: "setFrozen",
        args: [frozen],
      }),
    );
  }

  return (
    <div className="control-block">
      <h3>
        AgentAccount <span className="muted small">smart account · session keys</span>
      </h3>

      <div className="inline-form">
        <Field label="Client AgentAccount" hint="VITE_CLIENT_ACCOUNT, or paste one">
          <input
            className="input mono"
            value={accountInput}
            onChange={(event) => setAccountInput(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
          />
        </Field>
        <Field label="Session key to inspect" hint="address the agent signs with">
          <input
            className="input mono"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
          />
        </Field>
        {address ? (
          <button className="button button-small" type="button" onClick={() => setKeyInput(address)}>
            use connected
          </button>
        ) : null}
      </div>

      <ErrorNote message={readError} />
      {account === null && accountInput.trim() !== "" ? (
        <Notice kind="warn">That isn&apos;t an address yet (0x + 40 hex characters).</Notice>
      ) : null}

      {snapshot ? (
        <>
          <KeyValue
            items={[
              { label: "Owner", value: <AddressLink address={snapshot.owner} explorerUrl={config.explorerUrl} /> },
              {
                label: "Frozen",
                value: snapshot.frozen ? <Badge tone="bad">frozen — kill switch on</Badge> : <Badge tone="good">live</Badge>,
              },
              {
                label: "Budget guard",
                value: <AddressLink address={snapshot.budgetGuard} explorerUrl={config.explorerUrl} />,
              },
              {
                label: "Session",
                value:
                  key === null ? (
                    <span className="muted">enter a key address</span>
                  ) : (
                    <span>
                      <Badge tone={sessionStatus(snapshot.session, now) === "active" ? "good" : "neutral"}>
                        {sessionStatus(snapshot.session, now)}
                      </Badge>{" "}
                      {describeSession(
                        {
                          validUntil: Number(snapshot.session.validUntil),
                          perJobCap: snapshot.session.perJobCap,
                          dailyCap: snapshot.session.dailyCap,
                        },
                        now,
                      )}
                    </span>
                  ),
              },
            ]}
          />
          <p className="muted small">
            Read from the account at {formatTimestamp(now)} · signer {connected === null ? "not connected" : shortAddress(connected, 4)}
            {isOwner ? " (owner)" : " — not the owner"}
          </p>
          {!isOwner && connected !== null ? (
            <Notice kind="warn">
              Only the owner can change sessions or freeze the account. Connect the owner wallet{" "}
              <span className="mono">{shortAddress(snapshot.owner, 6)}</span> to enable the buttons.
            </Notice>
          ) : null}
        </>
      ) : null}

      <div className="control-form">
        <h4>Add a scoped session</h4>
        <div className="grid-3">
          <Field label="Key address">
            <input
              className="input mono"
              value={keyInput}
              onChange={(event) => setKeyInput(event.target.value)}
              placeholder="0x…"
              spellCheck={false}
            />
          </Field>
          <Field label="Expires in" hint="90s · 30m · 24h · 7d">
            <input className="input mono" value={duration} onChange={(event) => setDuration(event.target.value)} />
          </Field>
          <Field label="Per-job cap (tUSD8)">
            <input className="input mono" value={perJobCap} onChange={(event) => setPerJobCap(event.target.value)} />
          </Field>
          <Field label="Daily cap (tUSD8)">
            <input className="input mono" value={dailyCap} onChange={(event) => setDailyCap(event.target.value)} />
          </Field>
        </div>
        {draftError ? <Notice kind="warn">{draftError}</Notice> : null}
        <div className="button-row">
          <button className="button button-primary" type="button" disabled={!canWrite || writer.pending} onClick={() => void addSession()}>
            {writer.pending ? "Sending…" : "Add session"}
          </button>
          <button
            className="button"
            type="button"
            disabled={!canWrite || key === null || writer.pending}
            onClick={() => void revoke()}
          >
            Revoke this key
          </button>
          <button
            className="button button-danger"
            type="button"
            disabled={!canWrite || writer.pending}
            onClick={() => void freeze(snapshot ? !snapshot.frozen : true)}
          >
            {snapshot?.frozen ? "Unfreeze account" : "Freeze account"}
          </button>
        </div>
        {!canWrite ? (
          <p className="muted small">
            Writes are disabled until the account address is valid and the connected wallet is its owner.
          </p>
        ) : null}
        <p className="muted small">{REVOKE_NOTE}</p>
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

      {snapshot === null && account !== null ? <p className="muted small">Reading the account…</p> : null}
      <p className="muted small">
        Cap amounts are tUSD8 base units (6 decimals): {formatAmount(100000n)} tUSD8 = a 0.10 job.
      </p>
    </div>
  );
}
