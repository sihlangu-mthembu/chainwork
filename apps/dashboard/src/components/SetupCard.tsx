/**
 * SPDX-License-Identifier: MIT
 * Shown instead of the panels when no deployment is configured: says exactly what to set,
 * and explains the /deployment.json runtime fallback. Never crashes on an empty config.
 */
import { AEVUM_TESTNET } from "@chainwork/types";
import { FIELD_LABELS, isDeploymentReady, missingFields, type DashboardConfig } from "../config";
import { Notice, Panel } from "./ui";

export function SetupCard({ config, deploymentFound }: { config: DashboardConfig; deploymentFound: boolean }) {
  const missing = missingFields(config);
  if (isDeploymentReady(config) && missing.length === 0) return null;
  const required = missing.filter((field) => field === "escrow" || field === "reputation");
  return (
    <Panel
      title={required.length > 0 ? "Finish the setup" : "Almost there"}
      subtitle={
        "This dashboard reads a Chainwork deployment on " +
        AEVUM_TESTNET.name +
        " (chain " +
        AEVUM_TESTNET.id.toString() +
        "). No addresses are configured yet, so there is nothing to show."
      }
    >
      <Notice kind="warn">
        <strong>No deployment configured.</strong> Set the addresses in <code>.env</code> (see{" "}
        <code>apps/dashboard/.env.example</code>) and reload, or drop a <code>deployment.json</code> next to{" "}
        <code>index.html</code> — the dashboard fetches it at runtime when the env leaves a value unset.
        {deploymentFound ? " A deployment.json was found but it did not fill every gap." : ""}
      </Notice>

      <div className="setup-grid">
        <div>
          <h3>Missing</h3>
          <ul className="setup-list">
            {missing.map((field) => (
              <li key={field}>
                <code>{FIELD_LABELS[field]}</code>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>deployment.json</h3>
          <p className="muted">
            Shape (written by <code>contracts/script/Deploy.s.sol</code>): <code>chainId</code>,{" "}
            <code>escrow</code>, <code>reputation</code>, <code>budgetGuard</code>, <code>clientAccount</code>,{" "}
            <code>token</code>, <code>deployedAtBlock</code>. Precedence: env value, then deployment.json, then
            the Aevum defaults from <code>@chainwork/types</code>.
          </p>
          <p className="muted">
            On a local anvil chain also set <code>VITE_CHAIN_ID=31337</code>, <code>VITE_RPC_URL</code> and the
            local token address.
          </p>
        </div>
      </div>
    </Panel>
  );
}
