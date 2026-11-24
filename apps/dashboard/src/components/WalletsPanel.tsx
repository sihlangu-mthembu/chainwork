/**
 * SPDX-License-Identifier: MIT
 * T5.1 wallets panel: the connected account plus the eight demo roles, with live tQDAY and tUSD8
 * balances (5 s refresh) and explorer links. Addresses only, never keys.
 */
import { useMemo } from "react";
import { useAccount } from "wagmi";
import { AEVUM_TESTNET, type Address } from "@chainwork/types";
import { useConfig } from "../ConfigContext";
import { useWalletBalances } from "../hooks";
import { formatAmountRounded } from "../lib/format";
import { ROLE_WALLETS } from "../lib/wallets";
import { AddressLink, Badge, Notice, Panel } from "./ui";

interface WalletRow {
  role: string;
  label: string;
  address: Address;
  note?: string;
  connected: boolean;
}

export function WalletsPanel() {
  const { config } = useConfig();
  const { address } = useAccount();

  const targets = useMemo<WalletRow[]>(() => {
    const rows: WalletRow[] = [];
    if (address) {
      rows.push({ role: "you", label: "connected wallet", address, connected: true });
    }
    for (const wallet of ROLE_WALLETS) {
      const connected = address !== undefined && address.toLowerCase() === wallet.address.toLowerCase();
      rows.push({
        role: wallet.role,
        label: wallet.label,
        address: wallet.address,
        connected,
        ...(wallet.note ? { note: wallet.note } : {}),
      });
    }
    return rows;
  }, [address]);

  const addresses = useMemo(() => targets.map((row) => row.address), [targets]);
  const { rows: balances, error } = useWalletBalances(addresses);
  const byAddress = useMemo(() => {
    const map = new Map<string, (typeof balances)[number]>();
    for (const balance of balances) map.set(balance.address.toLowerCase(), balance);
    return map;
  }, [balances]);

  const failed = balances.filter((balance) => balance.error !== null);

  return (
    <Panel
      title="Wallets"
      subtitle={
        "Live balances, refreshed every 5 s. " +
        AEVUM_TESTNET.nativeCurrency.symbol +
        " is gas; tUSD8 is the money the escrow moves."
      }
      actions={
        <button className="button button-small" onClick={() => void navigator.clipboard?.writeText(targets.map((t) => t.address).join("\n"))}>
          Copy addresses
        </button>
      }
    >
      {error ? <Notice kind="bad">{error}</Notice> : null}
      {failed.length > 0 ? (
        <Notice kind="warn">
          {failed.length.toString()} balance read(s) failed — {failed[0]?.error ?? "unknown error"}
        </Notice>
      ) : null}

      <div className="table-wrap">
        <table className="table table-stack">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Address</th>
              <th scope="col" className="num">
                tQDAY
              </th>
              <th scope="col" className="num">
                tUSD8
              </th>
            </tr>
          </thead>
          <tbody>
            {targets.map((row) => {
              const balance = byAddress.get(row.address.toLowerCase());
              return (
                <tr key={row.role + row.address} className={row.connected ? "row-you" : undefined}>
                  <td>
                    <div className="role">
                      <span>{row.label}</span>
                      {row.connected ? <Badge tone="good">you</Badge> : null}
                    </div>
                    {row.note ? <span className="muted small">{row.note}</span> : null}
                  </td>
                  <td data-label="Address">
                    <AddressLink address={row.address} explorerUrl={config.explorerUrl} />
                  </td>
                  <td className="num mono" data-label="tQDAY">
                    {balance ? (balance.native === null ? "—" : formatAmountRounded(balance.native, AEVUM_TESTNET.nativeCurrency.decimals)) : "…"}
                  </td>
                  <td className="num mono" data-label="tUSD8">
                    {balance ? (balance.token === null ? "—" : formatAmountRounded(balance.token, 6, 6)) : "…"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Addresses come from docs/CONTEXT.md. The dashboard never sees a private key: writes are signed in your wallet.
      </p>
    </Panel>
  );
}
