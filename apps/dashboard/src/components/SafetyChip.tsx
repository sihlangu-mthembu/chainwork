/**
 * SPDX-License-Identifier: MIT
 * Always-visible safety state: is the client's smart account or budget guard frozen, and how much
 * of today's spending cap is used. One click opens the kill switches.
 */
import { useConfig } from "../ConfigContext";
import { useAgentAccount, useBudgetGuard } from "../hooks";
import { formatMoney } from "../lib/format";

export function SafetyChip({ onOpen }: { onOpen(): void }) {
  const { config } = useConfig();
  const account = config.clientAccount;
  const { snapshot: acct } = useAgentAccount(account, account);
  const { snapshot: guard } = useBudgetGuard(account);
  if (!account || (!acct && !guard)) return null;
  const frozen = acct?.frozen === true || guard?.limits.frozen === true;
  const perDay = guard?.limits.perDay ?? 0n;
  const spent = guard?.spentToday ?? 0n;
  const pct = perDay > 0n ? Math.min(100, Number((spent * 100n) / perDay)) : 0;
  return (
    <button type="button" className={frozen ? "safety is-frozen" : "safety"} onClick={onOpen} title="Open the kill switches">
      <span className="safety-state">{frozen ? "Client frozen" : "Client active"}</span>
      {perDay > 0n ? (
        <span className="safety-cap">
          <span className="safety-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
          {formatMoney(spent)} of {formatMoney(perDay)} today
        </span>
      ) : null}
    </button>
  );
}
