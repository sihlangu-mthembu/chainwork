/**
 * SPDX-License-Identifier: MIT
 * wagmi v2 config: the injected connector only (no WalletConnect project id to ship), Aevum as the
 * only chain, and a plain http transport to the RPC from @chainwork/types.
 */
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Chain } from "viem";
import { AEVUM_TESTNET } from "@chainwork/types";

export const aevumChain: Chain = {
  id: AEVUM_TESTNET.id,
  name: AEVUM_TESTNET.name,
  nativeCurrency: {
    name: AEVUM_TESTNET.nativeCurrency.name,
    symbol: AEVUM_TESTNET.nativeCurrency.symbol,
    decimals: AEVUM_TESTNET.nativeCurrency.decimals,
  },
  rpcUrls: {
    default: { http: [AEVUM_TESTNET.rpcUrl] },
    public: { http: [AEVUM_TESTNET.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "Aevum explorer", url: AEVUM_TESTNET.explorerUrl },
  },
  testnet: true,
};

const rpcUrl = import.meta.env.VITE_RPC_URL?.trim() || AEVUM_TESTNET.rpcUrl;
const envChainId = Number(import.meta.env.VITE_CHAIN_ID?.trim() || AEVUM_TESTNET.id);

/** A local chain (anvil, 31337) for rehearsing the demo; Aevum otherwise. */
export const activeChain: Chain =
  envChainId === AEVUM_TESTNET.id
    ? aevumChain
    : {
        id: envChainId,
        name: envChainId === 31337 ? "Local chain" : `Chain ${envChainId}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
        testnet: true,
      };

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [activeChain.id]: http(rpcUrl),
  },
  ssr: false,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
