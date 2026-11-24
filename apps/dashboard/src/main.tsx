/**
 * SPDX-License-Identifier: MIT
 * Entry point: wagmi (injected wallet) + React Query + the config/clock contexts.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ConfigProvider } from "./ConfigContext";
import { NowProvider } from "./NowContext";
import { wagmiConfig } from "./wagmi";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 500 },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing #root");

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <NowProvider>
            <App />
          </NowProvider>
        </ConfigProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
