/**
 * SPDX-License-Identifier: MIT
 * Presentation primitives shared by every panel (CSS-only styling, no UI framework).
 */
import type { ReactNode } from "react";
import type { Hex } from "@chainwork/types";
import type { Tone } from "../lib/state";
import { explorerAddressUrl, explorerTxUrl, shortAddress } from "../lib/format";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={wide ? "panel panel-wide" : "panel"}>
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="panel-sub">{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={"badge badge-" + tone}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export function ExternalLink({
  href,
  children,
  title,
}: {
  href: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <a className="link" href={href} target="_blank" rel="noreferrer noopener" title={title}>
      {children}
    </a>
  );
}

export function AddressLink({
  address,
  explorerUrl,
  full = false,
}: {
  address: string;
  explorerUrl: string;
  full?: boolean;
}) {
  return (
    <ExternalLink href={explorerAddressUrl(explorerUrl, address)} title={address}>
      <span className="mono">{full ? address : shortAddress(address, 6)}</span>
    </ExternalLink>
  );
}

export function TxLinks({ hashes, explorerUrl }: { hashes: readonly Hex[]; explorerUrl: string }) {
  if (hashes.length === 0) return null;
  return (
    <span className="tx-links">
      {hashes.map((hash) => (
        <ExternalLink key={hash} href={explorerTxUrl(explorerUrl, hash)} title={hash}>
          <span className="mono">{shortAddress(hash, 5)}</span>
        </ExternalLink>
      ))}
    </span>
  );
}

export function Notice({
  kind = "info",
  children,
}: {
  kind?: "info" | "warn" | "bad" | "good";
  children: ReactNode;
}) {
  return <div className={"notice notice-" + kind}>{children}</div>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Notice kind="bad">
      <strong>That didn&apos;t work. </strong>
      {message}
    </Notice>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="keyvalue">
      {items.map((item) => (
        <div key={item.label} className="keyvalue-row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
