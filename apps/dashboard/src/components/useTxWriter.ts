/**
 * SPDX-License-Identifier: MIT
 * One write-in-flight helper: sends a transaction, waits for its block, and turns every failure into
 * a plain-English sentence (never a raw revert string).
 */
import { useState } from "react";
import type { Hex } from "@chainwork/types";
import { useWaitForTransactionReceipt } from "wagmi";
import { toPlainError } from "../lib/errors";

export interface TxWriter {
  run: (label: string, action: () => Promise<Hex>) => Promise<void>;
  error: string | null;
  message: string | null;
  hash: Hex | null;
  confirmed: boolean;
  pending: boolean;
}

export function useTxWriter(): TxWriter {
  const [hash, setHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: hash ?? undefined });

  async function run(label: string, action: () => Promise<Hex>): Promise<void> {
    setError(null);
    setMessage(null);
    try {
      const sent = await action();
      setHash(sent);
      setMessage(label + " sent. Waiting for the block…");
    } catch (err) {
      setError(toPlainError(err));
    }
  }

  const confirmed = receipt.isSuccess;
  const block = receipt.data?.blockNumber;
  const finalMessage = confirmed && block !== undefined ? "Confirmed in block " + block.toString() + "." : message;

  return {
    run,
    error,
    message: finalMessage,
    hash,
    confirmed,
    pending: receipt.isLoading,
  };
}
