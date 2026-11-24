# Chainwork dashboard (L5)

A Vite + React 18 + TypeScript (strict) + wagmi v2 + viem SPA that shows a Chainwork deployment on
QDay **Aevum testnet** (chain 44005): live job trees, agent reputation, verifiable receipts and the
revocation / kill-switch controls the judging criteria ask for.

Nothing here holds a key or moves money on its own. Reads are `eth_call` read views; writes are
signed by your own wallet.

| Task | What it does |
|---|---|
| T5.1 | One-click **Add Aevum** (EIP-3085) + wallet connect, wallets panel with live tQDAY / tUSD8 |
| T5.2 | Job tree from escrow read views (`readTree`, `getJobsPage`), 1.5 s polling, explorer links |
| T5.3 | Reputation: score, bond rate, requiredBond, credit limit, getSummary, stats (+ optional indexer history) |
| T5.4 | Receipts: 500-block log chunks, totals, "paid sums to funded" check, JSON + PDF download |
| T5.5 | Plain-English errors from `@chainwork/sdk` `explainError`, challenge-window countdowns |
| T5.6 | AgentAccount sessions (add / revoke / freeze) and BudgetGuardHook limits + freeze |

## Run it

```bash
# from the repo root
pnpm install
pnpm -F dashboard dev          # http://localhost:5173
```

Production build and checks:

```bash
pnpm -F dashboard typecheck    # tsc --noEmit, strict
pnpm -F dashboard test         # vitest: pure helpers, no chain needed
pnpm -F dashboard build        # tsc + vite build -> apps/dashboard/dist
pnpm -F dashboard preview      # serve dist on http://localhost:4173
```

## Configuration

All values come from Vite env vars (copy `.env.example` to `.env`). Every one is optional: with no
addresses the app renders a setup card instead of crashing.

| Variable | Default | Used for |
|---|---|---|
| `VITE_CHAIN_ID` | 44005 (AEVUM_TESTNET.id) | chain id |
| `VITE_RPC_URL` | https://rpc-test.qday.info | reads |
| `VITE_EXPLORER_URL` | https://explorer-test.qday.info | every explorer link |
| `VITE_ESCROW` | — | tree, receipts |
| `VITE_REPUTATION` | — | reputation panel, tree |
| `VITE_BUDGET_GUARD` | — | BudgetGuard controls |
| `VITE_CLIENT_ACCOUNT` | — | AgentAccount controls, default guard subject |
| `VITE_TOKEN` | tUSD8 from `@chainwork/types` | balances |
| `VITE_FROM_BLOCK` | — | where receipts start scanning logs |
| `VITE_FACILITATOR_URL` | — | passed to the SDK config (x402 facilitator) |
| `VITE_INDEXER_URL` | — | optional `GET /events?jobId=` history |

Chain facts (id, name, currency, RPC, explorer) are read from `@chainwork/types` `AEVUM_TESTNET`;
the add-chain params are derived from them, so no number is hardcoded in this app.

### Runtime `/deployment.json` fallback

If the env leaves an address unset, the dashboard fetches `deployment.json` next to `index.html`
at startup and fills the gaps (env always wins). Copy the file the deploy script writes:

```bash
cp deployments/aevum.json apps/dashboard/public/deployment.json   # or point your web server at it
```

Shape: `chainId`, `token`, `escrow`, `reputation`, `budgetGuard`, `clientAccount`,
`deployedAtBlock`. A file for another chain is ignored with a visible warning. See
`deployment.example.json`. `public/deployment.json` and `dist/` are gitignored here.

## One-click add chain (EIP-3085)

1. Click **Connect wallet** — the injected connector (MetaMask, Rabby, Brave, …) asks for the account.
2. Click **Add Aevum** — the app sends `wallet_addEthereumChain` with
   `chainId 0xabe5`, `Aevum Testnet`, native currency `tQDAY` (18), RPC `https://rpc-test.qday.info`,
   explorer `https://explorer-test.qday.info`. The wallet shows its own confirmation; the button
   reports "Aevum added ✓" or a plain-English failure.
3. If the wallet is on another network, **Switch to Aevum** appears. If the wallet doesn't know the
   chain yet (error 4902) the app tells you to use Add Aevum first instead of failing silently.

## Using the panels

- **Wallets** — your account plus the eight demo roles from `docs/CONTEXT.md` (addresses only), with
  tQDAY (`getBalance`) and tUSD8 (`balanceOf`) refreshed every 5 s.
- **Job tree** — type a root job id or pick a recent job (from `getJobsPage`). Nodes show
  `UiJobState`, budget, bond, provider/client/evaluator, paid-to-children, the challenge countdown
  and explorer links. The tree is polled every 1.5 s and read *only* through read views — no
  `eth_getLogs`, so it works past Aevum's 1,000-block log cap. Transaction hashes appear once they
  are known (receipt lines, indexer events or transactions sent from this tab); the read views carry
  none.
- **Reputation** — any address, budget for `requiredBond`; shows score (bps), bond rate, required
  bond, credit limit, `getSummary` and raw stats. History needs the optional indexer; without it the
  panel says so instead of inventing data.
- **Receipts** — root id + from block (deployment block). The SDK `buildReceipt` pages logs in
  500-block chunks; the panel refuses a scan that would need more than 40 requests. The reconciliation
  line asserts paid lines == funded total, and the JSON and PDF downloads carry the same lines.
- **Controls** — AgentAccount: read owner/frozen/session for a key, then `addSession(key, validUntil,
  perJobCap, dailyCap)`, `revokeSession(key)`, `setFrozen(bool)` (owner only). BudgetGuardHook: read
  `limits` + `spentToday`, then `setLimits(perJob, perDay)` and `setFrozen(bool)`. Both blocks show the
  tx hash, wait for the receipt and report the outcome. Revocation is checked when the next funding
  signature is verified, so it takes effect on the next funding attempt — noted in the UI.

## Errors

Every failure goes through `src/lib/errors.ts` → `explainError` from `@chainwork/sdk`. Raw revert
strings and hex selectors are never rendered; wallet rejections and unreachable RPCs get their own
sentences.

## Tests

`vitest` covers the pure logic only (no chain, no browser): amount/duration/address formatting,
UiJobState → badge tone mapping, challenge countdown maths, receipt totals and the funded-total
assertion, log-scan budgeting, session draft parsing/validation, config merging (`deployment.json`),
EIP-3085 params, struct parsers and error decoding.

## Notes and limits

- The indexer (`services/indexer`, T3.2) is optional; the dashboard never depends on it.
- `getJobsPage` has no SDK wrapper yet (see the L2 note in `docs/TASKS.md`), so the app calls the
  read view directly through viem with the typed ABI from `@chainwork/types/abis`.
- No WalletConnect project id is shipped: the injected connector is the supported path.
- MIT licensed. Bundled libraries keep their own licences (jsPDF MIT, wagmi/viem MIT, React MIT).
