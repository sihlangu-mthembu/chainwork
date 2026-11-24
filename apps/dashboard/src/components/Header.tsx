/**
 * SPDX-License-Identifier: MIT
 * Top bar: wallet connect (injected), one-click add-chain (EIP-3085) and a network switch with
 * explicit state, so a demo never stalls on "wrong network".
 */
import { useState } from "react";
import { useBlockNumber } from "wagmi";
import { activeChain } from "../wagmi";
import { SafetyChip } from "./SafetyChip";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { AEVUM_TESTNET } from "@chainwork/types";
import { aevumAddChainParams, isUnrecognizedChain } from "../lib/addChain";
import { shortAddress } from "../lib/format";
import { toPlainError } from "../lib/errors";

interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

function injectedProvider(): Eip1193Provider | null {
  const candidate = (window as unknown as { ethereum?: unknown }).ethereum;
  if (candidate === null || typeof candidate !== "object") return null;
  const request = (candidate as { request?: unknown }).request;
  return typeof request === "function" ? (candidate as Eip1193Provider) : null;
}

type AddState = "idle" | "adding" | "added" | "failed";

export function Header({ onOpenControls }: { onOpenControls?(): void } = {}) {
  const { address, isConnected, connector } = useAccount();
  const { connectAsync, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [addState, setAddState] = useState<AddState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const onAevum = chainId === activeChain.id;
  const isAevum = activeChain.id === AEVUM_TESTNET.id;
  const { data: block } = useBlockNumber({ chainId: activeChain.id, watch: true });

  async function addAevum(): Promise<void> {
    setMessage(null);
    setAddState("adding");
    try {
      const fromConnector = connector ? ((await connector.getProvider()) as Eip1193Provider | undefined) : undefined;
      const provider = injectedProvider() ?? fromConnector ?? null;
      if (!provider) {
        setAddState("failed");
        setMessage("No injected wallet found. Install or unlock a browser wallet, then try again.");
        return;
      }
      await provider.request({ method: "wallet_addEthereumChain", params: [aevumAddChainParams()] });
      setAddState("added");
      setMessage(
        AEVUM_TESTNET.name +
          " (chain " +
          AEVUM_TESTNET.id.toString() +
          ") is in your wallet. Approve the switch when it asks.",
      );
    } catch (err) {
      setAddState("failed");
      setMessage(toPlainError(err, "The wallet refused to add " + AEVUM_TESTNET.name + "."));
    }
  }

  async function switchToAevum(): Promise<void> {
    setMessage(null);
    try {
      await switchChainAsync({ chainId: activeChain.id });
      setMessage("Switched to " + AEVUM_TESTNET.name + ".");
    } catch (err) {
      if (isUnrecognizedChain(err)) {
        setMessage("Your wallet doesn't know " + AEVUM_TESTNET.name + " yet — use Add Aevum first.");
        return;
      }
      setMessage(toPlainError(err, "The wallet refused the network switch."));
    }
  }

  async function connectWallet(): Promise<void> {
    setMessage(null);
    const target = connectors[0];
    if (!target) {
      setMessage("No injected wallet detected in this browser.");
      return;
    }
    try {
      await connectAsync({ connector: target });
    } catch (err) {
      setMessage(toPlainError(err, "The wallet refused the connection."));
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true">
          <rect x="2" y="7" width="13" height="14" rx="3" fill="none" stroke="#e8edf5" strokeWidth="2" />
          <rect x="13" y="7" width="13" height="14" rx="3" fill="none" stroke="#e6b450" strokeWidth="2" />
          <circle cx="14" cy="14" r="2.2" fill="#e6b450" />
        </svg>
        <span className="brand-name">Chainwork</span>
        <span className="brand-line">Escrow for AI agents that hire other agents</span>
      </div>

      <div className="topbar-actions">
        {onOpenControls ? <SafetyChip onOpen={onOpenControls} /> : null}
        <span className="netstat" title={activeChain.rpcUrls.default.http[0]}>
          <span className={block !== undefined ? "netstat-dot is-live" : "netstat-dot"} aria-hidden="true" />
          {activeChain.name}
          {block !== undefined ? <span className="netstat-block">block {block.toString()}</span> : <span className="netstat-block">connecting…</span>}
        </span>

        {isConnected ? (
          <>
            {!onAevum ? (
              <button className="button button-primary" onClick={() => void switchToAevum()} disabled={switching}>
                {switching ? "Switching…" : `Switch to ${activeChain.name}`}
              </button>
            ) : null}
            <button className="button" onClick={() => disconnect()} title={address ?? ""}>
              Disconnect {address ? shortAddress(address, 4) : ""}
            </button>
          </>
        ) : (
          <button className="button button-primary" onClick={() => void connectWallet()} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}

        {isAevum ? (
          <button className="button button-ghost" onClick={() => void addAevum()} disabled={addState === "adding"}>
            {addState === "adding" ? "Adding…" : addState === "added" ? "Aevum added" : "Add Aevum to wallet"}
          </button>
        ) : null}
      </div>

      {message ? <p className={"topbar-message " + (addState === "failed" ? "topbar-message-bad" : "")}>{message}</p> : null}
    </header>
  );
}
