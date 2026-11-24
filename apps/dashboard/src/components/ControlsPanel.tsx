/**
 * SPDX-License-Identifier: MIT
 * T5.6 controls panel: the client's AgentAccount sessions and freeze, plus the BudgetGuardHook caps
 * and kill switch. Both blocks read the chain and write through wagmi with plain-English feedback.
 */
import { Panel, Notice } from "./ui";
import { AgentAccountControls } from "./AgentAccountControls";
import { BudgetGuardControls } from "./BudgetGuardControls";

export function ControlsPanel() {
  return (
    <Panel
      title="Controls"
      subtitle="Owner-only revocation and kill switches. Writes are signed by your wallet — the dashboard holds no keys."
      wide
    >
      <Notice kind="info">
        <strong>Demo kill switch (S5):</strong> freeze the AgentAccount (no new signatures) or the BudgetGuard (no new
        funding), then watch the next funding attempt fail with a plain-English reason.
      </Notice>
      <div className="controls-grid">
        <AgentAccountControls />
        <BudgetGuardControls />
      </div>
    </Panel>
  );
}
