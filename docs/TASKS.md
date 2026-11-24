# TASKS.md — Chainwork task board

Status values: `todo` · `in-progress (<who>)` · `blocked (<why>)` · `requested` · `done (<commit>)`.
Gates: **G1 Nov 26** live job settles on Aevum · **G2 Nov 28** full demo tree live · **Submit Nov 30** · feature freeze Dec 8 · deadline Dec 11 08:00 UTC.

Until L1 deploys to Aevum (T1.10), DeepSeek lanes build against the ABIs in `packages/types/abi/` and a local `anvil` chain. Claude ships `T1.9 DeployLocal` (escrow + a local FiatToken V2.2 copy + seeded wallets) by **Nov 25 end of day** so services can run end to end locally.

## Ops (human)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T0.1 | 8 wallets generated (addresses in CONTEXT.md). Keys go into encrypted keystores in `C:\dev\chainwork` once that folder is connected; never committed | keystores exist locally | in-progress (claude) |
| T0.2 | Faucet: 5 tQDAY to every wallet (web faucet, 24 h limit). Discord `/faucet` tUSD8 for client, specialist-bad, backup, watcher. **Leave the coordinator at 0 tUSD8** (that's the demo). | balances visible on the explorer | todo |
| T0.3 | Starter kit = 8-page PDF guide; notes in the OneDrive `reference/starter-guide-notes.md` (official judging wording) | done | done (claude) |
| T0.4 | Discord: faucet top-up requested (the web faucet needs a mainnet balance; tUSD8 web faucet is 1/day). Also ask: Sourcify for 44005? public x402 facilitator endpoint? | answers added to CONTEXT.md | in-progress (human) |
| T0.5 | Clone the repo to `C:\dev\chainwork` (outside OneDrive) and connect that folder to the Claude desktop app | folder connected | todo (human) |
| T0.6 | Public GitHub repo created and attached: https://github.com/sihlangu-mthembu/chainwork | repo URL in README | done (claude) |

## L1 Contracts (Claude)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T1.1 | Foundry setup: forge-std, OpenZeppelin 5.1, Circle FiatToken V2.2 test fixture (pre-linked, attributed) | `forge build` | done (claude) |
| T1.2 | ReputationRegistry: stats, score, bondBps curve, requiredBond, creditLimit, getSummary; onlyEscrow writes | `forge test --mc SubJobs` | done (claude) |
| T1.3 | ChainworkEscrow core: ERC-8183 lifecycle, hooks, claimRefund, read views | `forge test --mc "Funding|Views"` | done (claude) |
| T1.4 | Gasless funding: termsHash, fundWithAuthorization via receiveWithAuthorization (EOA and ERC-1271 client) | `forge test --mc "Funding|AgentAccount"` | done (claude) |
| T1.5 | acceptJob with permit bonds; settlement and bond routing rules | `forge test --mc Bonds` | done (claude) |
| T1.6 | createSubJob, credit check, child settlement, childrenRoot, maxSubcontract | `forge test --mc SubJobs` | done (claude) |
| T1.7 | Challenges: challenge, finalize, evaluator resolution, challenge-bond routing; settleTree | `forge test --mc Challenge` | done (claude) |
| T1.8 | BudgetGuardHook; HashVerifier; SignedDataVerifier; **AgentAccount** (ERC-1271 smart account, scoped session keys) | `forge test --mc "Guard|Verifier|AgentAccount"` | done (claude) |
| T1.9 | DeployLocal script for anvil (real FiatToken V2.2 as tUSD8, funded roles, coordinator at 0) | `anvil --hardfork shanghai & forge script contracts/script/Deploy.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast` | done (claude) |
| T1.10 | Invariant suite (I1, I2, I4, terminal-holds-nothing; guided handler reaches every transition) done. DeployAevum script done. **Deploy to Aevum waits on testnet funds** | `forge test`; addresses on explorer | in-progress (claude) |

## L2 SDK (Claude)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T2.1 | `@chainwork/sdk`: termsHash, signFunding (EOA + AgentAccount session), quote validation (payTo == escrow, sane bond/expiry, worst-case loss) | `pnpm -F @chainwork/sdk test` | done (claude) |
| T2.2 | fund (direct or via facilitator), accept (permit), subcontract, submit, submitParent, submitWithProof, challenge, finalize, settleTree; retries on transient RPC errors | `CHAINWORK_LOCAL=1 pnpm -F @chainwork/sdk test` | done (claude) |
| T2.3 | readTree(rootId) via eth_call only → `JobNode`; UI state mapping; receipt builder with 500-block log chunks | `CHAINWORK_LOCAL=1 pnpm -F @chainwork/sdk test` | done (claude) |
| T2.4 | Plain-English error decoding for every custom error and FiatToken revert string | `pnpm -F @chainwork/sdk test` | done (claude) |
| T2.5 | `packages/sdk/scripts/gate1.ts` (fund → accept → submit → finalize, explorer links) and `fund-wallets.ts` (split deployer funds; coordinator gets gas only). Both pass on the local chain. **Aevum run waits on testnet funds** | `NETWORK=aevum pnpm -F @chainwork/sdk gate1` prints GATE 1 PASSED | blocked (testnet funds) |
| T2.6 | SDK wrapper for the escrow read view `getJobsPage(cursor, limit)` returning jobs, exts and nextCursor (the dashboard calls the view directly today; T5.2 needs the wrapper so paging logic lives in L2) | `pnpm -F @chainwork/sdk typecheck`; dashboard imports the wrapper instead of `readJobsPage` | requested |

## L3 Services (DeepSeek)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T3.0 | Check x402 v2 header and field names against the official spec; record differences in `docs/X402_ESCROW_SCHEME.md` via an `L0:` PR | PR opened | blocked (gh unauthenticated; L0 change committed on branch `l0/x402-v2-conformance`) |
| T3.1 | `services/facilitator`: Fastify + viem; `/supported`, `/verify`, `/settle`, `/escrow/fund`, `/jobs/:id` exactly per the scheme spec; relayer key from env; plain-English `invalidReason` | `pnpm -F facilitator test` (verify rejects tampered terms, wrong payTo, used nonce, low balance) | done (deepseek) |
| T3.2 | `services/indexer`: polls escrow events in 500-block chunks into SQLite; resumes from last block; `/events?jobId=` | survives restart; never requests > 1,000 blocks | todo |
| T3.3 | `services/watcher`: for each Submitted job with a window, fetch `GET /jobs/{id}/output` from the worker, re-run the job's check (JSON schema + content rules from the job spec), call `challenge` if it fails, before the window ends | test with a bad output gets challenged; good output does not | todo |
| T3.4 | `services/evaluator`: resolves challenged jobs by re-running the same check; signs `complete`/`reject` with reason hash; logs reasoning to `evaluator.log` | challenged bad job → rejected; challenged good job → completed | todo |
| T3.6 | Idempotency + retries everywhere (judging: "handles retries, idempotency, async failures"): settle keyed by termsHash, watcher/evaluator safe to restart, exponential backoff on RPC | restart any service mid-demo; no duplicate or lost actions | todo |
| T3.5 | Worker HTTP template (`services/worker-kit`): 402 quote from chain reads, PAYMENT-SIGNATURE handling via facilitator, acceptJob, output endpoint | curl 402 → sign → 202 with jobId | todo |

## L4 Agents (DeepSeek builds; Claude writes T4.4 scenarios)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T4.1 | Agent runtime: LLM tool-calling loop where the only money tools are SDK calls; deterministic replay mode (record/replay LLM decisions, real chain txs) | `pnpm -F agents test` | todo |
| T4.2 | Roles: client, coordinator (subcontracts, assembles, submits Merkle root), specialist-data, specialist-bad (returns invalid output), backup | each role runs alone against anvil | todo |
| T4.3 | `demo:seed`: real past jobs that give the coordinator a proven reputation (bond 0, credit ≥ 0.10) | `reputation.bondBps(coordinator) == 0` on chain | todo |
| T4.4 | Failure scenarios and demo task definition (Claude): `docs/DEMO_SCENARIOS.md` (S0 seed, S1 zero-capital tree, S2 challenge + re-hire, S3 ghosting refund, S4 prompt injection, S5 kill switch; canonical JSON + metrics function) | spec merged | done (claude) |
| T4.5 | `demo:all` and `demo:reset` | **G2**: full tree on Aevum in < 3 min | todo |

## L5 Dashboard (DeepSeek)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T5.1 | Vite + React + wagmi + viem; one-click add Aevum (EIP-3085); wallets panel with live balances | loads on mobile and desktop | done (deepseek 6669da9) |
| T5.2 | Live job tree from read views (no getLogs): nodes with UiJobState, money on edges, explorer links per tx | updates within 2 s of a block | done (deepseek 2eb1efe) |
| T5.3 | Reputation panel: score, bond rate, credit limit, history | matches chain reads | done (deepseek 418162c) |
| T5.4 | Receipts: per-tree receipt view + download (JSON and PDF) | receipt lines sum to funded total | done (deepseek 9806369) |
| T5.5 | Plain-English errors from SDK; challenge-window countdowns | no raw revert strings shown | done (deepseek 0314b6f) |
| T5.6 | Controls panel (judging: "easy revocation/approval controls"): AgentAccount sessions list, add/revoke session, freeze; BudgetGuard limits and freeze | revoke takes effect on the next funding attempt | done (deepseek d277c5f) |

## L6 Docs, Docker, verification

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T6.1 | `docker-compose.yml`: facilitator, indexer, watcher, evaluator, dashboard, agents (DeepSeek) | clean clone → `docker compose up` works | todo |
| T6.2 | README draft: problem, architecture, workflows, tech stack, addresses, compiler settings, how to run (DeepSeek drafts, Claude edits) | covers the 4 required doc items | todo |
| T6.3 | `.env.example`, LICENSE (MIT), NOTICE (DeepSeek) | no secrets in repo | todo |
| T6.4 | `scripts/verify-bytecode.sh`: rebuild with pinned settings, compare runtime bytecode to `cast code`, masking only compiler-listed immutables (metadata hash kept, so it proves the exact source) (Claude) | passes on local deployment in CI; fails on swapped addresses | done (claude) |
| T6.6 | README sections the judges name: known assumptions, limitations, roadmap, distribution plan, path to mainnet, API reference | all present | todo |
| T6.5 | Demo video script and recording checklist (DeepSeek drafts, human records) | video attached on DoraHacks | todo |

## L0 Spec (Claude)

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T0.10 | `docs/THREAT_MODEL.md`: 21 threats, each mapped to a test; assumptions and limitations; red-team log | reviewed | done (claude) |

## L7 Red team

| ID | Task | Acceptance | Status |
|---|---|---|---|
| T7.1 | DeepSeek attacks contracts after T1.10: bond routing, credit bypass, child/parent ordering, refund blocking, signature/terms tampering, rounding | each finding = failing test in `contracts/test/redteam/` | todo |
| T7.2 | Claude attacks services and agents: facilitator verify bypass, watcher timing, evaluator spoofing, prompt injection into agents | each finding = failing test | todo |
