/**
 * SPDX-License-Identifier: MIT
 * Top bar: wallet connect (injected), one-click add-chain (EIP-3085) and a network switch with
 * explicit state, so a demo never stalls on "wrong network".
 */
import { useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { AEVUM_TESTNET } from "@chainwork/types";
import { aevumAddChainParams, isUnrecognizedChain } from "../lib/addChain";
import { shortAddress } from "../lib/format";
import { toPlainError } from "../lib/errors";
import { Badge } from "./ui";

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

export function Header() {
  const { address, isConnected, connector } = useAccount();
  const { connectAsync, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [addState, setAddState] = useState<AddState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const onAevum = chainId === AEVUM_TESTNET.id;

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
      await switchChainAsync({ chainId: AEVUM_TESTNET.id });
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
        <span className="brand-mark" aria-hidden="true">
          ⛓
        </span>
        <div>
          <h1>Chainwork</h1>
          <p>Pay-on-delivery escrow for AI agents · {AEVUM_TESTNET.name}</p>
        </div>
      </div>

      <div className="topbar-actions">
        <span className={onAevum && isConnected ? "chip chip-good" : "chip"}>
          {isConnected ? (onAevum ? AEVUM_TESTNET.name : "Wrong network") : "Wallet not connected"}
        </span>

        {isConnected ? (
          <>
            {!onAevum ? (
              <button className="button button-primary" onClick={() => void switchToAevum()} disabled={switching}>
                {switching ? "Switching…" : "Switch to Aevum"}
              </button>
            ) : null}
            <button className="button" onClick={() => disconnect()} title={address ?? ""}>
              {address ? shortAddress(address, 4) : "Connected"} · disconnect
            </button>
          </>
        ) : (
          <button className="button button-primary" onClick={() => void connectWallet()} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}

        <button className="button button-ghost" onClick={() => void addAevum()} disabled={addState === "adding"}>
          {addState === "adding" ? "Adding…" : addState === "added" ? "Aevum added ✓" : "Add Aevum"}
        </button>
      </div>

      {message ? (
        <p className={"topbar-message " + (addState === "failed" ? "topbar-message-bad" : "")}>{message}</p>
      ) : (
        <p className="topbar-message">
          <Badge tone="info">EIP-3085</Badge> One click adds the chain (id {AEVUM_TESTNET.id.toString()},{" "}
          {AEVUM_TESTNET.nativeCurrency.symbol}, {AEVUM_TESTNET.rpcUrl}).
        </p>
      )}
    </header>
  );
}
