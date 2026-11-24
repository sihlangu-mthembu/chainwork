/**
 * SPDX-License-Identifier: MIT
 * The dashboard shell: the job-tree story first (what a visitor came to see), then the operator
 * desk in tabs: wallets, all jobs, reputation, receipts and the kill switches.
 */
import { useState } from "react";
import { useConfig } from "./ConfigContext";
import { Header } from "./components/Header";
import { SetupCard } from "./components/SetupCard";
import { TreeStory } from "./components/TreeStory";
import { WalletsPanel } from "./components/WalletsPanel";
import { TreePanel } from "./components/TreePanel";
import { ReputationPanel } from "./components/ReputationPanel";
import { ReceiptsPanel } from "./components/ReceiptsPanel";
import { ControlsPanel } from "./components/ControlsPanel";
import { ExternalLink, Notice } from "./components/ui";
import { configProblems, isDeploymentReady } from "./config";
import { activeChain } from "./wagmi";

const DESK = [
  { id: "wallets", label: "Wallets", render: () => <WalletsPanel /> },
  { id: "jobs", label: "All jobs", render: () => <TreePanel /> },
  { id: "reputation", label: "Reputation", render: () => <ReputationPanel /> },
  { id: "receipts", label: "Receipts", render: () => <ReceiptsPanel /> },
  { id: "controls", label: "Kill switches", render: () => <ControlsPanel /> },
] as const;

type DeskId = (typeof DESK)[number]["id"];

export function App() {
  const { config, warnings, loading, deploymentFound } = useConfig();
  const problems = configProblems(config);
  const [tab, setTab] = useState<DeskId>("wallets");
  const current = DESK.find((d) => d.id === tab) ?? DESK[0];
  return (
    <div className="app">
      <Header />

      <main className="layout">
        {warnings.map((warning) => (
          <Notice key={warning} kind="warn">
            {warning}
          </Notice>
        ))}
        {loading ? <p className="muted small">Looking for the deployment file…</p> : null}

        <SetupCard config={config} deploymentFound={deploymentFound} />

        {isDeploymentReady(config) && problems.length > 0 ? (
          <Notice kind="info">
            {problems.map((problem) => (
              <div key={problem}>{problem}</div>
            ))}
          </Notice>
        ) : null}

        <TreeStory />

        <section className="desk" aria-label="Operator desk">
          <div className="desk-tabs" role="tablist">
            {DESK.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={d.id === tab}
                className={d.id === tab ? "desk-tab is-active" : "desk-tab"}
                onClick={() => setTab(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="desk-body" role="tabpanel">
            {current.render()}
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>
          Watching {activeChain.name} (chain {activeChain.id.toString()})
          {config.escrow ? (
            <>
              , escrow{" "}
              <ExternalLink href={`${config.explorerUrl.replace(/\/$/, "")}/address/${config.escrow}`}>{config.escrow}</ExternalLink>
            </>
          ) : null}
          . This page holds no keys and moves no money on its own: every write is signed in your wallet.
        </p>
      </footer>
    </div>
  );
}
