/// <reference types="vite/client" />

/**
 * SPDX-License-Identifier: MIT
 * The dashboard's env surface. Everything is optional: the app falls back to the Aevum chain facts in
 * @chainwork/types and to /deployment.json, and renders a setup card when addresses are missing.
 */
interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_ESCROW?: string;
  readonly VITE_TOKEN?: string;
  readonly VITE_REPUTATION?: string;
  readonly VITE_BUDGET_GUARD?: string;
  readonly VITE_CLIENT_ACCOUNT?: string;
  readonly VITE_FROM_BLOCK?: string;
  readonly VITE_FACILITATOR_URL?: string;
  readonly VITE_INDEXER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
