/**
 * SPDX-License-Identifier: MIT
 * The dashboard shell: header, setup card when unconfigured, then wallets, tree, reputation,
 * receipts and controls. Every panel degrades to a clear message instead of crashing.
 */
import { AEVUM_TESTNET, TUSD8 } from "@chainwork/types";
import { useConfig } from "./ConfigContext";
import { Header } from "./components/Header";
import { SetupCard } from "./components/SetupCard";
import { WalletsPanel } from "./components/WalletsPanel";
import { TreePanel } from "./components/TreePanel";
import { ReputationPanel } from "./components/ReputationPanel";
import { ReceiptsPanel } from "./components/ReceiptsPanel";
import { ControlsPanel } from "./components/ControlsPanel";
import { ExternalLink, Notice } from "./components/ui";
import { configProblems, isDeploymentReady } from "./config";
import { shortAddress } from "./lib/format";

export function App() {
  const { config, warnings, loading, deploymentFound } = useConfig();
  const problems = configProblems(config);
  return (
    <div className="app">
      <Header />

      <main className="layout">
        {warnings.map((warning) => (
          <Notice key={warning} kind="warn">
            {warning}
          </Notice>
        ))}
        {loading ? <p className="muted small">Looking for a runtime deployment.json…</p> : null}

        <SetupCard config={config} deploymentFound={deploymentFound} />

        {isDeploymentReady(config) && problems.length > 0 ? (
          <Notice kind="info">
            {problems.map((problem) => (
              <div key={problem}>{problem}</div>
            ))}
          </Notice>
        ) : null}

        <WalletsPanel />
        <TreePanel />
        <ReputationPanel />
        <ReceiptsPanel />
        <ControlsPanel />
      </main>

      <footer className="footer">
        <p>
          {AEVUM_TESTNET.name} · chain {AEVUM_TESTNET.id.toString()} · tUSD8{" "}
          <span className="mono">{shortAddress(TUSD8.address, 6)}</span> ·{" "}
          <ExternalLink href={AEVUM_TESTNET.explorerUrl}>explorer</ExternalLink>
        </p>
        <p className="muted small">
          Chain facts come from @chainwork/types; error text is decoded from the ABIs by @chainwork/sdk. Nothing here
          custodies funds or keys.
        </p>
      </footer>
    </div>
  );
}
