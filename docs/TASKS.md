# TASKS.md — Chainwork task board

Status values: `todo` · `in-progress (<who>)` · `blocked (<why>)` · `requested` · `done (<commit>)`.
Gates: **G1 Nov 26** live job settles on Aevum · **G2 Nov 28** full demo tree live · **Submit Nov 30** · feature freeze Dec 8 · deadline Dec 11 08:00 UTC.

Until L1 deploys to Aevum (T1.10), DeepSeek lanes build against the ABIs in `packages/types/abi/` and a local `anvil` chain. Claude ships `T1.9 DeployLocal` (escrow + a local FiatToken V2.2 copy + seeded wallets) by **Nov 25 end of day** so services can run end to end locally.

## Ops (human)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T0.1 | Create 8 wallets: deployer/facilitator relayer, client, coordinator, specialist-data, specialist-bad, backup, watcher, evaluator. Keys only in local `.env`. | `.env` filled; addresses listed in `docs/CONTEXT.md` (addresses only) | todo |
| T0.2 | Faucet: 5 tQDAY to every wallet (web faucet, 24 h limit). Discord `/faucet` tUSD8 for client, specialist-bad, backup, watcher. **Leave the coordinator at 0 tUSD8** (that's the demo). | balances visible on the explorer | todo |
| T0.3 | Download the starter kit from the challenge page; put it in `reference/starter-kit/` (gitignored) and tell Claude | folder exists | todo |
| T0.4 | Ask in Discord: does Sourcify support chain 44005? Is the QDay x402 facilitator endpoint public? Can we get a tUSD8 top-up for demo wallets? | answers added to CONTEXT.md | todo |
| T0.5 | Move this repo **out of OneDrive** (e.g. `C:\dev\chainwork`) or exclude `node_modules`/`out`/`.git` from sync; OneDrive corrupts git and slows installs | `git status` clean after a sync | todo |
| T0.6 | Create the public GitHub repo (MIT) and attach it to the Claude session | repo URL in README | todo |

## L1 Contracts (Claude)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T1.1 | Foundry setup: forge-std, OpenZeppelin (non-transient ReentrancyGuard, SafeERC20, ECDSA, MerkleProof), vendored Circle FiatToken V2.2 for tests (attributed) | `forge build` | todo |
| T1.2 | ReputationRegistry: stats, score, bondBps curve, requiredBond, creditLimit, getSummary; onlyEscrow writes | `forge test --mc Reputation` | todo |
| T1.3 | ChainworkEscrow core: ERC-8183 lifecycle, hooks, claimRefund, read views | `forge test --mc EscrowCore` | todo |
| T1.4 | Gasless funding: termsHash, fundWithAuthorization via receiveWithAuthorization (EOA and ERC-1271 client) | `forge test --mc Funding` | todo |
| T1.5 | acceptJob with permit bonds; settlement and bond routing rules | `forge test --mc Bonds` | todo |
| T1.6 | createSubJob, credit check, child settlement, childrenRoot, maxSubcontract | `forge test --mc SubJobs` | todo |
| T1.7 | Challenges: challenge, finalize, evaluator resolution, challenge-bond routing; settleTree | `forge test --mc Challenge` | todo |
| T1.8 | BudgetGuardHook; HashVerifier; SignedDataVerifier | `forge test --mc "Guard|Verifier"` | todo |
| T1.9 | DeployLocal script for anvil (mock tUSD8 = FiatToken V2.2 copy, seeded wallets) | `anvil & forge script DeployLocal --broadcast` prints addresses | todo |
| T1.10 | Invariant suite I1–I7 + 1,000-run fuzz; DeployAevum script; deploy; write `deployments/aevum.json` | `forge test`; addresses on explorer | todo |

## L2 SDK (Claude)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T2.1 | `@chainwork/sdk`: termsHash, signFunding (EOA + smart account), quote validation (payTo == escrow, sane bond/expiry) | `pnpm -F sdk test` | todo |
| T2.2 | hire (via facilitator or direct), accept (permit), subcontract, submit, submitWithProof, challenge, finalize, settleTree | `pnpm -F sdk test` | todo |
| T2.3 | readTree(rootId) from getJobsPage/getChildren → `JobNode`; UI state mapping; receipt builder | `pnpm -F sdk test` | todo |
| T2.4 | Plain-English error decoding for every custom error | snapshot test | todo |
| T2.5 | `scripts/gate1.ts`: fund → accept → submit → finalize on Aevum (run by human) | **G1** | todo |

## L3 Services (DeepSeek)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T3.0 | Check x402 v2 header and field names against the official spec; record differences in `docs/X402_ESCROW_SCHEME.md` via an `L0:` PR | PR opened | todo |
| T3.1 | `services/facilitator`: Fastify + viem; `/supported`, `/verify`, `/settle`, `/escrow/fund`, `/jobs/:id` exactly per the scheme spec; relayer key from env; plain-English `invalidReason` | `pnpm -F facilitator test` (verify rejects tampered terms, wrong payTo, used nonce, low balance) | todo |
| T3.2 | `services/indexer`: polls escrow events in 500-block chunks into SQLite; resumes from last block; `/events?jobId=` | survives restart; never requests > 1,000 blocks | todo |
| T3.3 | `services/watcher`: for each Submitted job with a window, fetch `GET /jobs/{id}/output` from the worker, re-run the job's check (JSON schema + content rules from the job spec), call `challenge` if it fails, before the window ends | test with a bad output gets challenged; good output does not | todo |
| T3.4 | `services/evaluator`: resolves challenged jobs by re-running the same check; signs `complete`/`reject` with reason hash; logs reasoning to `evaluator.log` | challenged bad job → rejected; challenged good job → completed | todo |
| T3.5 | Worker HTTP template (`services/worker-kit`): 402 quote from chain reads, PAYMENT-SIGNATURE handling via facilitator, acceptJob, output endpoint | curl 402 → sign → 202 with jobId | todo |

## L4 Agents (DeepSeek builds; Claude writes T4.4 scenarios)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T4.1 | Agent runtime: LLM tool-calling loop where the only money tools are SDK calls; deterministic replay mode (record/replay LLM decisions, real chain txs) | `pnpm -F agents test` | todo |
| T4.2 | Roles: client, coordinator (subcontracts, assembles, submits Merkle root), specialist-data, specialist-bad (returns invalid output), backup | each role runs alone against anvil | todo |
| T4.3 | `demo:seed`: real past jobs that give the coordinator a proven reputation (bond 0, credit ≥ 0.10) | `reputation.bondBps(coordinator) == 0` on chain | todo |
| T4.4 | Failure scenarios and demo task definition (Claude) | spec merged | todo |
| T4.5 | `demo:all` and `demo:reset` | **G2**: full tree on Aevum in < 3 min | todo |

## L5 Dashboard (DeepSeek)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T5.1 | Vite + React + wagmi + viem; one-click add Aevum (EIP-3085); wallets panel with live balances | loads on mobile and desktop | todo |
| T5.2 | Live job tree from read views (no getLogs): nodes with UiJobState, money on edges, explorer links per tx | updates within 2 s of a block | todo |
| T5.3 | Reputation panel: score, bond rate, credit limit, history | matches chain reads | todo |
| T5.4 | Receipts: per-tree receipt view + download (JSON and PDF) | receipt lines sum to funded total | todo |
| T5.5 | Plain-English errors from SDK; challenge-window countdowns | no raw revert strings shown | todo |

## L6 Docs, Docker, verification

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T6.1 | `docker-compose.yml`: facilitator, indexer, watcher, evaluator, dashboard, agents (DeepSeek) | clean clone → `docker compose up` works | todo |
| T6.2 | README draft: problem, architecture, workflows, tech stack, addresses, compiler settings, how to run (DeepSeek drafts, Claude edits) | covers the 4 required doc items | todo |
| T6.3 | `.env.example`, LICENSE (MIT), NOTICE (DeepSeek) | no secrets in repo | todo |
| T6.4 | `scripts/verify-bytecode.sh`: rebuild with pinned settings, compare runtime bytecode to `cast code` for each deployed address, masking immutables and metadata (Claude) | passes on every address | todo |
| T6.5 | Demo video script and recording checklist (DeepSeek drafts, human records) | video attached on DoraHacks | todo |

## L7 Red team

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T7.1 | DeepSeek attacks contracts after T1.10: bond routing, credit bypass, child/parent ordering, refund blocking, signature/terms tampering, rounding | each finding = failing test in `contracts/test/redteam/` | todo |
| T7.2 | Claude attacks services and agents: facilitator verify bypass, watcher timing, evaluator spoofing, prompt injection into agents | each finding = failing test | todo |
