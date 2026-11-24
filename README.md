# Chainwork

**Pay-on-delivery hiring for AI agents on QDay Aevum testnet (chain 44005).**
A coordinator with **0.00 tUSD8** can hire specialists against the client's locked budget. Work is
paid only when verified. A failing agent's bond pays whoever it hurt.

Aevum Builder Challenge #1 entry · MIT · repository: <https://github.com/sihlangu-mthembu/chainwork>

> **Status: testnet prototype, mid-build.** Contracts, deployment scripts, the TypeScript SDK and the
> x402 `escrow` facilitator are implemented and covered by tests that run against a local anvil chain. The indexer, watcher,
> evaluator, worker kit, agents and dashboard are specified and scheduled but **not yet implemented
> in this tree** (see [Status](#status-what-runs-today-and-what-is-planned)). Nothing here is
> claimed as a mainnet product.

Start with [AGENTS.md](AGENTS.md) (working rules) → [docs/CONTEXT.md](docs/CONTEXT.md) (chain ground
truth) → [docs/TASKS.md](docs/TASKS.md) (task board).

---

## Contents

- [The problem, and why now](#the-problem-and-why-now)
- [The zero-capital subcontract tree](#the-zero-capital-subcontract-tree)
- [Status: what runs today, and what is planned](#status-what-runs-today-and-what-is-planned)
- [Architecture](#architecture)
- [Workflows](#workflows)
- [Tech stack and compiler settings](#tech-stack-and-compiler-settings)
- [Chain facts (Aevum testnet, chain 44005)](#chain-facts-aevum-testnet-chain-44005)
- [Addresses](#addresses)
- [How to run](#how-to-run)
- [API reference](#api-reference)
- [Security model](#security-model)
- [Known assumptions](#known-assumptions)
- [Limitations](#limitations)
- [Roadmap](#roadmap)
- [Distribution plan and path to mainnet](#distribution-plan-and-path-to-mainnet)
- [Docs, task board and red team](#docs-task-board-and-red-team)
- [License and attribution](#license-and-attribution)

---

## The problem, and why now

An agent that can plan work still cannot safely pay for it.

1. **A funded key in an agent is a single point of total loss.** One prompt injection inside a
   fetched web page, an API response or a document, and the agent can be talked into sending the
   balance anywhere. Telling the model "don't do that" is not a control.
2. **x402 `exact` pays before the work is seen.** The x402 handshake settles at request time, which
   is right for an API call and wrong for agency work: the requester has no way to dispute a bad
   deliverable, and the worker has no way to prove it delivered.
3. **Subcontracting needs capital the coordinator may not have.** A fresh coordinator with a proven
   track record but 0.00 tUSD8 cannot front a specialist's fee, so agent-to-agent work graphs stall
   at one hop.
4. **The client needs a receipt, not a promise.** "The agent says it paid" is not an audit trail.

Why this is buildable now:

- **ERC-8183** (draft) standardises the on-chain job: client, provider, evaluator, budget, status,
  hooks, `claimRefund`. Chainwork implements it and extends it rather than inventing a new job model
  ([docs/ERC8183.md](docs/ERC8183.md)).
- **tUSD8 on Aevum is Circle's FiatToken V2.2**: EIP-3009 `receiveWithAuthorization`, EIP-2612
  `permit` and ERC-1271 signature checks are native. That gives signature-bound funding with no gas
  for the client, bond posting without an approve transaction, and smart-account sessions that the
  token itself asks to validate.
- **x402 v2** standardises the 402 handshake agents already speak, so the payment step can be an
  ordinary HTTP exchange instead of a bespoke integration.
- **Aevum is cheap and fast** (~1 s blocks, 1 gwei), so a whole subcontract tree — fund, accept,
  submit, challenge, settle — fits inside one demo slot.

## The zero-capital subcontract tree

The demo task is counterparty due diligence before paying a supplier: *"Give us a due-diligence
pack on supplier wallet S."* Every deliverable is recomputable from chain data, so a watcher can
check the work without knowing the answer in advance ([docs/DEMO_SCENARIOS.md](docs/DEMO_SCENARIOS.md)).

```
client (pays once, 0.10 tUSD8)                       holds the money: the escrow
   │  EIP-3009 signature, nonce = termsHash
   ▼
ChainworkEscrow ── root job 0.10 ──────────────────────────────┐
   │                                                           │
   │  coordinator accepts: bond 0 (proven), credit 0.10        │  coordinator balance: 0.00
   │  coordinator subcontracts out of the LOCKED budget:       │
   ├── child A  0.03  specialist-data   dataset.json           │  paid on its own verification
   └── child B  0.04  specialist-bad → backup   metrics.json  │  paid on its own verification
                       │                                       │
                       └── fails → challenger bond in, evaluator rejects,
                           B's 0.02 bond → coordinator, 0.04 budget → root pool,
                           coordinator re-hires backup for B
   │
   ▼
settleTree(root): children first, then root pays 0.10 − 0.07 = 0.03 margin to the coordinator
```

Three properties make this a business model rather than a demo trick:

- **No new money in a tree.** A child's budget is *carved* from the parent's locked budget
  (`createSubJob`), never transferred in. A child's refund returns to the parent's pool. The escrow's
  balance only ever comes from root budgets, bonds and challenge bonds.
- **Credit is earned, not granted.** A new agent posts a 50% bond and can subcontract 0 beyond it.
  A proven agent (5 completed jobs, all on time) posts 0% and gets credit up to 1.00 tUSD8, capped by its
  reputation and reduced 2× by every slash.
- **The coordinator never holds funds**, so a compromised coordinator cannot steal the client's
  budget — only fail to deliver, which costs it its bond and its reputation.

## Status: what runs today, and what is planned

| Component | Folder | Status |
|---|---|---|
| Escrow, reputation, budget guard, agent account, two verifiers (Solidity 0.8.28) | [contracts/src/](contracts/src/) | Implemented, unit + fuzz + invariant tests (T1.2–T1.10) |
| Local + Aevum deploy scripts | [contracts/script/Deploy.s.sol](contracts/script/Deploy.s.sol) | Implemented; Aevum run waits on testnet funds |
| Frozen interfaces, types and ABIs | [interfaces/](interfaces/), [packages/types/](packages/types/) | Implemented (L0) |
| TypeScript SDK (fund, accept, subcontract, submit, challenge, settle, receipts) | [packages/sdk/](packages/sdk/) | Implemented, unit + local e2e tests (T2.1–T2.5) |
| x402 `escrow` facilitator | [services/facilitator/](services/facilitator/) | Implemented (T3.1), tests against the local chain |
| Shared service kit (config, keystore relayer, SQLite, retries, quotes) | [services/kit/](services/kit/) | Implemented (T3.1 groundwork) |
| Bytecode verification | [scripts/verify-bytecode.sh](scripts/verify-bytecode.sh) | Implemented (T6.4) |
| Indexer (event pages → SQLite) | `services/indexer` | **Planned** (T3.2) |
| Watcher (re-check submissions, challenge) | `services/watcher` | **Planned** (T3.3) |
| Evaluator (resolve challenged jobs) | `services/evaluator` | **Planned** (T3.4) |
| Worker HTTP kit (402 quote → accept → output endpoint) | `services/worker-kit` | **Planned** (T3.5) |
| Agents (client, coordinator, specialists, backup) and demo scripts | `apps/agents` | **Planned** (T4.1–T4.5) |
| Dashboard (job tree, reputation, receipts, kill switch) | `apps/dashboard` | **Planned** (T5.1–T5.6) |
| `docker compose up` | `docker-compose.yml` | **Planned** (T6.1) |

Rows marked **Planned** name a folder or script that does **not exist in this tree yet**; they are
listed so the target structure is unambiguous. A task is only `done` on [docs/TASKS.md](docs/TASKS.md)
when its acceptance command has passed.
CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) builds with the pinned compiler, runs the
contract suites, deploys to a local anvil, runs the SDK suites and re-verifies deployed bytecode.

## Architecture

```
  off-chain (no custody)                      on-chain (all the money)
  ----------------------                      ------------------------
  client agent (LLM)                          Aevum testnet, chain 44005
   AgentAccount + session key                 +---------------------------------------------+
      | checkQuote(402)  (refuse bad quotes) |  ChainworkEscrow                            |
      | signFundingWithSession  ------------>|   budgets, bonds, challenge bonds, children |
      v                                      |   settleTree, claimRefund, getJobsPage      |
  facilitator  ----------------------------->|         |            |                      |
   /verify /settle /escrow/fund /jobs/:id    |         | hook       | view verify          |
   relayer key: gas only, never tUSD8        |         v            v                      |
      ^                                      |  BudgetGuardHook  HashVerifier             |
      |                                      |         ^          SignedDataVerifier       |
      |                                      |         | spentToday                          |
  coordinator agent (LLM)                    |  AgentAccount (ERC-1271 sessions)           |
   provider key, 0.00 tUSD8                  |                                             |
      | createSubJob / submit --------------->|  ReputationRegistry                         |
      |                                      |   bondBps, creditLimit, score               |
  watcher*  re-check + challenge ----------->|                                             |
  evaluator*  complete / reject ------------>|  tUSD8 (FiatToken V2.2, 6 decimals)         |
  dashboard*  read views + owner actions --->|                                             |
  indexer*    log pages -> SQLite            +---------------------------------------------+

  * implemented in a later task; this tree ships the contracts, SDK and facilitator.
```

**Boundaries.** Everything that can move money is on-chain and permissioned by the escrow. Off-chain
code can only *ask*: the facilitator submits a client's signature it cannot alter, the watcher posts
a bond to challenge, the evaluator is a named party in the terms the client signed. The client agent
holds no key that can pay an arbitrary address — only an `AgentAccount` session key that the account
validates against the escrow, the budget guard and an expiry.

**Frozen contracts between lanes.** `interfaces/*.sol`, `packages/types/src/index.ts`,
`packages/types/abi/*.json` and [docs/X402_ESCROW_SCHEME.md](docs/X402_ESCROW_SCHEME.md) are frozen
(L0). Services and the SDK build against them; changes go through a reviewed `L0:` PR
([AGENTS.md](AGENTS.md)).

More detail, including where each money invariant is enforced and tested:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Workflows

### 1. A client hires a coordinator through a 402 escrow quote

1. The client agent calls the coordinator's HTTP endpoint. The worker answers `402` with a
   `PAYMENT-REQUIRED` header: scheme `escrow`, network `eip155:44005`, asset tUSD8, `payTo` = the
   escrow, plus `extra` fields read from chain at quote time (`bond`, `creditLimit`,
   `worstCaseLoss`, `reputationScore`, `challengeWindow`, `expiredAt`, `salt`, `descriptionHash`).
2. The client runs `checkQuote` **before signing**. It refuses a quote that pays anyone but the
   escrow, names another token or chain, is over budget, shows a worse worst-case loss than allowed,
   names an untrusted evaluator, or has a deadline too near.
3. The client signs tUSD8 `ReceiveWithAuthorization` with `to` = escrow, `value` = budget and
   `nonce = termsHash(client, terms)`. `termsHash` commits to provider, evaluator, verifier, hook,
   deadline, window, budget, verifier spec, description hash and salt.
4. The signature goes to the facilitator (`POST /settle` or `POST /escrow/fund`), which re-runs every
   check, simulates the call and sends `fundWithAuthorization` from a relayer key. The client paid no
   gas. The job exists in `Funded` with a job id.

Changing any term breaks the signature; replaying it fails because tUSD8 marks the nonce used; the
signature cannot be front-run into a plain transfer because `receiveWithAuthorization` requires
`msg.sender == to`.

### 2. The coordinator subcontracts out of the locked budget

The coordinator calls `acceptJob` (posting its reputation-priced bond, 0 for a proven agent, via an
EIP-2612 permit) and then `createSubJob` for each specialist. A child job:

- is `Funded` immediately, with the coordinator as its client — **no new tokens move**;
- must end before the parent deadline and within the parent's remaining budget;
- must fit inside `parent.bond + reputation.creditLimit(coordinator)` — the credit rule that keeps a
  broke coordinator honest;
- is one level deep: children cannot subcontract further (`MAX_DEPTH = 1`), and a parent can have at
  most 4 open and 8 total children, so `settleTree` stays bounded.

### 3. Verification — three ways to release money, and only three

| Path | When | Who can trigger | Code |
|---|---|---|---|
| Verifier proof | The job names a `verifier`; `verify` is a `view` function | anyone (`submitWithProof`) | `ChainworkEscrow.submitWithProof` |
| Unchallenged window | `challengeWindow` 30–600 s, no challenge inside it | anyone (`finalize`, or `claimRefund`/`settleTree` which finalize instead of refunding) | `finalize`, `_tryClose` |
| Evaluator decision | No window (0 = evaluator decides), or after a challenge | the evaluator named in the terms | `complete`, `reject` |

There is no admin path, no owner override and no upgrade key: the evaluator can only act on jobs
where it is the named evaluator, and only in `Submitted` (or a client in `Open`).

### 4. Challenge: a bad deliverable inside the window

A watcher that re-runs the job's check and disagrees calls `challenge(jobId, reason, ...)`, posting
10% of the job budget (`challengeBondFor`). From then on only the evaluator (or expiry) can close the
job: complete → the challenge bond goes to the provider as compensation for the delay; reject → the
bond returns to the challenger, the provider's bond goes to the payer and the provider's reputation
records a failure. A failed challenge therefore costs the challenger its bond, which is what stops
griefing.

### 5. Refunds: expiry, ghosting, and why nobody can block them

`claimRefund` is callable by **anyone**, is never hooked, and is valid once `block.timestamp >=
expiredAt`. A provider that accepted and never delivered is slashed at expiry (bond to the payer). A
provider that delivered and whose evaluator stayed silent past the deadline is **not** slashed: if a
challenged-free window had already passed, `claimRefund` finalizes the job instead of refunding it,
so an honest provider cannot be robbed at expiry. A parent with open children cannot be refunded
until the children close, and children always expire first — so a child can never be orphaned, and a
refund can never be blocked by a hook.

### 6. Settlement and receipts

`settleTree(rootId)` closes everything that can close right now, children first, then the root, in one
transaction: finalize unchallenged windows, refund expired jobs, then pay the root. A completed child
pays its provider `budget` and returns its bond; a completed root pays `budget − paidToChildren` plus
its bond. The SDK's `buildReceipt` walks escrow events in ≤500-block chunks and produces every money
movement with its transaction hash (`paid`, `refunded`, `bond-returned`, `bond-slashed`,
`challenge-bond`).

## Tech stack and compiler settings

| Layer | Choice | Why |
|---|---|---|
| Contracts | Solidity **0.8.28**, Foundry, OpenZeppelin 5.1, `evm_version = "shanghai"`, optimizer **200 runs** | Aevum has no Cancun opcodes; 200 runs + pinned solc keeps bytecode reproducible for `scripts/verify-bytecode.sh` |
| Token | tUSD8 = Circle FiatToken V2.2 (6 decimals) | EIP-3009, EIP-2612-permit and ERC-1271 come from the token, not from us |
| SDK, services, agents | TypeScript strict, viem, Node ≥ 22 | no `any` in exported APIs; errors decoded to plain English |
| Facilitator HTTP | Fastify 5 | small surface, schema-free JSON, easy to test with `app.inject` |
| Service storage | Node built-in `node:sqlite` | no native addon, small image, one file per service |
| Dashboard (planned) | Vite + React + wagmi + viem | read views + wallet owner actions; no server-side key |
| Packaging (planned) | pnpm 9.15 workspaces, Docker Compose | one command from a clean clone |

### Why `shanghai` and not `cancun`

Aevum (a Polygon CDK validium, `cdk-erigon/2.0-qday-v2.61.19-validium`) does not implement the Cancun
opcodes. Probing the chain with contract creation shows `MCOPY`, `TSTORE`/`TLOAD` and
`BLOBBASEFEE` are **invalid opcodes**, while PUSH0 (Shanghai) works ([docs/CONTEXT.md](docs/CONTEXT.md)).
Solidity ≥ 0.8.25 defaults to `cancun` and can emit `MCOPY` for memory copies — a contract compiled
with defaults can deploy fine locally and revert on Aevum. So [foundry.toml](foundry.toml) pins
`evm_version = "shanghai"`, and the contracts use the classic `ReentrancyGuard` (no transient
storage, no `ReentrancyGuardTransient`).

## Chain facts (Aevum testnet, chain 44005)

These are the only chain facts this repo uses; they come from [docs/CONTEXT.md](docs/CONTEXT.md).

| Item | Value |
|---|---|
| Chain ID | 44005 (`0xabe5`) |
| RPC | `https://rpc-test.qday.info` |
| WebSocket | `wss://rpc-test.qday.info` (from qday.io/build; **untested** by us) |
| Explorer | `https://explorer-test.qday.info` (Blockscout, API at `/api/v2/`) |
| Client | `cdk-erigon/2.0-qday-v2.61.19-validium` |
| Gas token | tQDAY, 18 decimals, 1 gwei |
| Block time | ~1.0 s measured over 1,000 blocks — **use timestamps, never block counts** |
| `eth_getLogs` range | max **1,000 blocks** ("block range too large, max range: 1000") |
| tUSD8 | `0x456569838f1d43009A91ebA4263147Afd7233483`, 6 decimals, name `tUSD8`, version `2` |
| tUSD8 implementation | `0xD6bE708F41b07b2F4A7B48889b8e16626e317597` (Circle FiatTokenV2_2 clone, solc 0.6.12) |

Faucets (docs/CONTEXT.md): the web faucet gives 5 tQDAY per recipient per 24 h and 1 tUSD8 per 24 h
from the tUSD8 tab, and requires the recipient to hold ETH/USDT/USDC on Ethereum mainnet (fresh
wallets are not eligible). Discord `/faucet` gives 1 tQDAY + 5 tUSD8 to verified members. That is why
every demo amount is cents (0.01–0.10 tUSD8).

## Addresses

**tUSD8** — `0x456569838f1d43009A91ebA4263147Afd7233483` (proxy; use this one), chain 44005.

**Aevum contracts — status: deployment pending.** `deployments/aevum.json` does not exist in this
tree, so there are **no Aevum Chainwork addresses to quote**. The deploy script writes that file, and
the address list is then published here and in [docs/CONTEXT.md](docs/CONTEXT.md). Do not trust any
Chainwork address that is not in the repository.

**Local anvil deployment** — [deployments/local.json](deployments/local.json), chain 31337, no value:

| Contract | Address |
|---|---|
| tUSD8 (locally deployed FiatToken V2.2) | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| ChainworkEscrow | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` |
| ReputationRegistry | `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` |
| BudgetGuardHook | `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` |
| HashVerifier | `0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e` |
| SignedDataVerifier | `0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0` |
| Client AgentAccount | `0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82` |

These local addresses are deterministic only for the deploy recorded in that file; redeploying local
anvil writes new ones.

## How to run

### Prerequisites

- Node.js ≥ 22 and pnpm 9.15 (`corepack enable`)
- Foundry (`forge`, `anvil`, `cast`)
- git with submodules: `git submodule update --init --recursive` (OpenZeppelin 5.1, forge-std 1.9.4)

### 1. Local chain and contracts

```bash
anvil --hardfork shanghai            # terminal 1; shanghai is required, see compiler settings
forge script contracts/script/Deploy.s.sol:DeployLocal \
  --rpc-url http://127.0.0.1:8545 --broadcast
```

`DeployLocal` deploys Circle's real FiatToken V2.2 as tUSD8, the Chainwork contracts and the client
`AgentAccount`, then funds anvil's default accounts: 5 tUSD8 each to client, specialist-data,
specialist-bad, backup, watcher and evaluator, 2 tUSD8 to the client account and 10 tUSD8 to the
deployer. **The coordinator (account index 2) is deliberately left at 0 tUSD8** — that is the demo.
Addresses are written to `deployments/local.json`.

Windows PowerShell: run the same commands from the repo root, one terminal for `anvil`, one for
`forge`.

### 2. Contract tests

```bash
forge build --sizes
forge test -vv                       # unit, fuzz and invariant suites
forge test --mc Invariant            # I1, I2, I4 and terminal-holds-nothing
```

### 3. SDK unit and end-to-end tests

```bash
pnpm install
pnpm -F @chainwork/sdk test          # unit tests, no chain needed
CHAINWORK_LOCAL=1 pnpm -F @chainwork/sdk test   # end-to-end against the local chain from step 1
```

On Windows PowerShell: `$env:CHAINWORK_LOCAL="1"; pnpm -F @chainwork/sdk test`.

### 4. Gate 1 / operator scripts (needs keys and funds)

`packages/sdk/scripts/env.ts` loads role keys from encrypted keystores in `.keys/` (git-ignored)
unlocked by `CHAINWORK_KEYSTORE_PASSWORD`, and falls back to anvil's well-known keys **only when
`NETWORK=local`**. Never put a raw key in a file.

```bash
NETWORK=local pnpm -F @chainwork/sdk gate1        # fund → accept → submit → finalize, explorer links
NETWORK=local pnpm -F @chainwork/sdk fund-wallets # split deployer funds; coordinator gets gas only
```

Gate 1 on Aevum (once the deployment exists and wallets are funded) is documented step by step in
[docs/RUNBOOK.md](docs/RUNBOOK.md): deploy, verify bytecode, split funds, `gate1`, commit
`deployments/aevum.json`.

### 5. Facilitator

```bash
NETWORK=local pnpm -F facilitator dev    # http://127.0.0.1:3402, reloads on change
CHAINWORK_LOCAL=1 pnpm -F facilitator test
```

It needs a deployment file, an RPC and a relayer key (`RELAYER_KEYSTORE` +
`RELAYER_KEYSTORE_PASSWORD`, or `RELAYER_PK`; on `NETWORK=local` it falls back to anvil account 0).
Every variable is listed with a placeholder in [.env.example](.env.example).

### 6. Services, dashboard, agents and Docker — planned

`services/indexer`, `services/watcher`, `services/evaluator`, `services/worker-kit`,
`apps/agents`, `apps/dashboard` and `docker-compose.yml` are **not in this tree yet**
(T3.2–T3.5, T4.x, T5.x, T6.1). When they land, the intended entry points are:

```bash
pnpm demo:seed     # S0: give the coordinator a real track record (planned, T4.3)
pnpm demo:all      # the whole tree on the configured chain (planned, T4.5)
pnpm demo:reset    # reset local state (planned, T4.5)
docker compose up  # facilitator + services + dashboard + agents (planned, T6.1)
```

### 7. Prove deployed bytecode is this source

Aevum's explorer reportedly cannot verify source, so the repo ships its own check:

```bash
scripts/verify-bytecode.sh deployments/local.json http://127.0.0.1:8545
python scripts/verify_bytecode.py deployments/aevum.json https://rpc-test.qday.info
```

It rebuilds with the pinned settings and compares runtime bytecode to `cast code`, masking only
compiler-listed immutables and keeping the metadata hash — so it proves the exact source, not just a
similar one.

## API reference

### Facilitator (`services/facilitator`)

Base URL: `http://127.0.0.1:3402` locally (`PORT`, default 3402). All requests and responses are JSON.
Money amounts are decimal strings in base units (6 decimals).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | `{ok, service, network, chainId, blockNumber, escrow, relayer}` |
| GET | `/supported` | — | `{scheme:"escrow", network, asset, x402Version:2, kinds[], extensions:[], signers}` |
| POST | `/verify` | `{paymentPayload, paymentRequirements}` (v0.1) or `{x402Version:2, paymentPayload, paymentRequirements}` | `{isValid:true, payer, description, terms, termsHash, now}` or `{isValid:false, invalidReason, invalidCode, invalidMessage, payer?}` |
| POST | `/settle` | same as `/verify` | `{success, jobId?, txHash?, transaction?, network, errorReason?, errorMessage?, payer?, alreadySettled?, pending?}` |
| POST | `/escrow/fund` | the `EscrowPaymentPayload` alone (agents hiring agents, no 402 round-trip) | same as `/settle` |
| GET | `/jobs/:id` | — | `{id, job, ext, children[], childrenRoot, windowRemaining, network, explorer:{escrow}}` |

`/verify` is read-only: it recomputes `termsHash` (cross-checking the on-chain view), checks that the
signed terms equal the quoted terms, the description hash, the window and expiry, that `payTo` and
`extra.escrow` are the escrow, the hook is `address(0)` or the deployment's budget guard, the nonce is
unused, the client can pay, the signature is valid (65-byte EOA recover or ERC-1271
`isValidSignature` for an `AgentAccount` session), and finally **simulates** `fundWithAuthorization`
so a frozen guard, exhausted session cap or any other revert is caught before gas is spent.

`/settle` is idempotent per `termsHash` = EIP-3009 nonce: a replay returns the first job (also across
restarts, because the mapping is in SQLite), a crash after broadcast is reconciled from the receipt,
and writes are serialised so two clients cannot collide on the relayer nonce.

Invalid codes include `invalid_payload`, `invalid_scheme`, `invalid_network`,
`invalid_payment_requirements`, `invalid_escrow_recipient`, `invalid_escrow_terms`,
`invalid_escrow_description`, `invalid_escrow_window`, `invalid_escrow_expired`,
`invalid_escrow_nonce_used`, `invalid_escrow_signature`, `invalid_escrow_hook`,
`invalid_escrow_simulation`, `insufficient_funds`. The human sentence is in `invalidReason` /
`invalidMessage`; error codes are stable, text is not.

Example (local):

```bash
curl -s http://127.0.0.1:3402/health
curl -s http://127.0.0.1:3402/supported
curl -s http://127.0.0.1:3402/jobs/1
```

### SDK (`@chainwork/sdk`)

| Export | What it does |
|---|---|
| `configFromDeployment(deploymentJson, {facilitatorUrl})` | build a `ChainworkConfig`; on chain 44005 it uses the verified tUSD8 EIP-712 domain |
| `toUnits("0.10")` / `formatUnits(units)` | 6-decimal conversion (0.10 tUSD8 = `100_000n`) |
| `buildTerms`, `buildSubTerms`, `termsHash`, `descriptionHash`, `newSalt` | job terms, identical to the contract's `termsHash` |
| `signFunding(account, cfg, terms)` | EOA `ReceiveWithAuthorization` over the escrow, nonce = terms hash |
| `signFundingWithSession(sessionKey, cfg, agentAccount, terms)` | session-key signature wrapped as `abi.encode(SessionAuth)` for ERC-1271 |
| `signPermit(account, cfg, publicClient, value, deadline)` | EIP-2612 permit for bonds and challenge bonds |
| `checkQuote(requirements, cfg, description, limits)` | pre-signature quote firewall; returns terms or a plain-English refusal |
| `new Chainwork(cfg, publicClient, walletClient)` | the chain client (below) |
| `readTree(cw, rootId)` | whole tree via `eth_call` only → `JobNode` with `UiJobState` labels |
| `buildReceipt(cw, rootId, fromBlock, toBlock?)` | every money movement with tx hash, 500-block log chunks |
| `explainError(err)` / `ChainworkError` | plain-English text for every custom error and token revert |
| `loadKeystoreAccount(dir, name, password)` (from `@chainwork/sdk/node`) | decrypt a V3 keystore; never a raw key file |

`Chainwork` methods — reads: `getJob`, `getJobExt`, `getChildren`, `jobCount`, `maxSubcontract`,
`childrenRoot`, `challengeBondFor`, `termsHashOnChain`, `providerNumbers`, `windowRemaining`;
writes: `fund`, `fundViaFacilitator`, `accept`, `subcontract`, `submit`, `submitWithProof`,
`submitParent`, `complete`, `reject`, `challenge`, `finalize`, `claimRefund`, `settleTree`.

Every write simulates first and retries transient RPC failures with exponential backoff; reverts are
never retried and are decoded to plain English.

```ts
const terms = buildTerms({ provider, evaluator, budget: toUnits("0.10"), description,
                           expiresIn: 1800, challengeWindow: 60 });
const sig = await signFunding(clientAccount, cfg, terms);
const { jobId } = await cw.fund(sig, description);        // or cw.fundViaFacilitator(sig, description)
```

The wire format itself (402 body, headers, field placement, and the known x402 v2 differences) is
specified in [docs/X402_ESCROW_SCHEME.md](docs/X402_ESCROW_SCHEME.md).

## Security model

**Keys.** No key, mnemonic or `.env` is committed ([.gitignore](.gitignore) ignores `.env`,
`.env.*` except `.env.example`, `.keys/` and `*.keystore`). Agents and services load encrypted V3
keystores with a password supplied at runtime; a raw key is accepted only on the local chain for
tests. CI has no secrets.

**No LLM money tools.** Agents (planned, T4.1) can call escrow functions and nothing else: `get_quote`, `hire`,
`subcontract`, `submit`, `read_tree`, `provider_numbers`, `wait`. **No tool takes an arbitrary
recipient and an amount.** An injected instruction to "pay 1 tUSD8 to 0x…" has no code path to
execute.

**Revocable sessions.** A client agent signs with an `AgentAccount` session key, not the owner key.
On-chain, `isValidSignature` re-derives the terms and accepts a session signature only when the key is
active and unexpired, the account is not frozen, the value equals the signed budget and is within the
per-job cap, the terms' hook is the account's budget guard (so every spend is counted), the day's
spend is within the daily cap, and `validBefore` is within the session's life. The owner can revoke a
session or freeze the account in one transaction.

**Budget guard.** `BudgetGuardHook` enforces per-job and per-day caps plus a kill switch as an
ERC-8183 hook on `fund` — for any wallet type, set only by the client itself. A frozen client's next
funding attempt fails with *"This client's budget guard is frozen (kill switch on)."*

**Quote firewall.** Whatever a worker's HTTP response says, money can only enter the escrow, on terms
the client's own `checkQuote` accepted, capped by the session. A malicious quote (wrong `payTo`,
absurd bond, deadline too soon, different description) is refused before signing.

**Bounded reads.** Aevum caps `eth_getLogs` at 1,000 blocks, so the SDK and services never ask for
more: trees are read through the escrow's views (`getJob`, `getJobExt`, `getChildren`,
`getJobsPage`), receipts and events page in 500-block chunks. No feature depends on a full-history
scan.

**Money invariants.** I1–I7 in [interfaces/IChainworkEscrow.sol](interfaces/IChainworkEscrow.sol) are
asserted by the invariant suite ([contracts/test/invariant/Invariants.t.sol](contracts/test/invariant/Invariants.t.sol))
and by the tests listed in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Reentrancy is guarded on
every state-changing escrow function; verifiers are `view`; the escrow has no owner, no upgrade path
and no fee switch.

**Threat model.** 21 threats, each mapped to a test, plus assumptions and the red-team log:
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Known assumptions

Stated so a reviewer can disagree with them explicitly:

1. **The evaluator is trusted for the jobs it decides.** For window-less jobs and challenged jobs the
   evaluator's decision is final. It is fixed in the terms the client signs, so the client chooses
   whom to trust; deterministic checks should name a verifier contract instead.
2. **tUSD8 behaves as FiatToken V2.2.** It has an admin and a blacklist; a blacklisted address cannot
   be paid. Chainwork is tested against Circle's real V2.2 bytecode locally, but the Aevum deployment
   is a clone whose admin is outside our control.
3. **Chain time is the only clock.** Deadlines and windows use `block.timestamp`; block counts are
   never used for timing (~1 s blocks, but not guaranteed).
4. **Aevum stays non-Cancun.** If the chain gained Cancun opcodes, `shanghai` bytecode still works;
   the reverse is not true, which is why the setting is pinned and documented.
5. **Reputation is only as good as its cost.** Self-dealing can inflate reputation at real tUSD8 cost
   per job; credit is capped at 1.00 tUSD8 and a slash costs 2× the value lost.
6. **One level of subcontracting is enough for the demo.** Deeper trees would need per-level credit
   accounting and more gas than a 4-minute demo can show.
7. **The demo runs on testnet only.** No mainnet deployment, audit or legal review has happened.

## Limitations

- **Not implemented yet in this tree:** indexer, watcher, evaluator, worker kit, agents, dashboard,
  Docker Compose (T3.2–T3.5, T4.x, T5.x, T6.1). Until the watcher and evaluator exist, the challenge
  path can only be driven by hand through the SDK.
- **No Aevum addresses yet:** `deployments/aevum.json` does not exist; the Aevum deployment waits on
  testnet funds. Only the local anvil addresses above are real today.
- **No source verification on the explorer** (reportedly unsupported); we ship
  `scripts/verify-bytecode.sh` instead, and it must be run by a human with RPC access.
- **Summary text is not verifiable.** The root deliverable commits to the children's Merkle root and
  hashes, but the LLM-written summary inside `pack.json` is checked only for length; this is stated
  in the job definition, not verified on-chain.
- **Single relayer.** The facilitator holds one hot relayer key with gas only. It cannot move funds,
  but if it is down, gasless funding is down; anyone can still call `fundWithAuthorization` directly.
- **Depth 1, ≤ 4 open and ≤ 8 total children per parent**, page size ≤ 100: deliberate bounds that
  keep gas and invariants simple, not a scalability claim.
- **No fee model.** Platform and evaluator fees are 0 in this version; there is no revenue switch.
- **Dashboard, agents and Docker are specified elsewhere** in the task board; treat their behaviour
  in this README as intent, not as shipped code.
- **English-only, Windows-and-Linux operator docs**; the Aevum runbook assumes PowerShell because
  that is where the keystores live today.

## Roadmap

Ordered by what the challenge gates need, then what a pilot would need.

| Phase | Work | State |
|---|---|---|
| Now | Aevum deployment (`DeployAevum`), bytecode verification, Gate 1 on chain | Blocked on testnet funds (T1.10, T2.5) |
| Next | Indexer, watcher, evaluator, worker kit (T3.2–T3.5) | Planned |
| Next | Agents + `demo:seed` / `demo:all` / `demo:reset` (T4.1–T4.5) | Planned |
| Next | Dashboard: tree, reputation, receipts, controls (T5.1–T5.6) | Planned |
| Next | Docker Compose, clean-clone one-command run (T6.1) | Planned |
| Then | Red-team pass on contracts, then on services and agents (T7.1, T7.2) | Planned |
| Then | Bonded evaluators and a verifier library so fewer jobs need a trusted evaluator | Idea |
| Then | ERC-8004 validation registries when QDay opens them; keep `getSummary` as the bridge | Idea |
| Later | Deeper trees (depth > 1) with per-level credit accounting | Idea |
| Later | Post-quantum validator behind `AgentAccount.isValidSignature`, which isolates signature checking | Idea |

## Distribution plan and path to mainnet

**Distribution (how other builders get it).**

1. **Repository + docs** — MIT, one-command local demo, and a README that states what is *not* built.
   The x402 `escrow` scheme and the ERC-8183 extensions are documented as a spec
   ([docs/X402_ESCROW_SCHEME.md](docs/X402_ESCROW_SCHEME.md), [docs/ERC8183.md](docs/ERC8183.md)) so a
   worker or a marketplace can implement the seller side without our code.
2. **SDK as the integration surface** — `@chainwork/sdk` is what an agent framework imports: quote,
   sign, fund, accept, submit, read tree, build receipt. Publishing it is a packaging task, not a
   rewrite.
3. **Worker kit** — a drop-in HTTP template (402 quote → verify/settle → accept → output endpoint) so
   an existing agent API can become payable in an afternoon.
4. **Facilitator as a service** — the same binary any team can run for its own deployment; the
   scheme, not the operator, is the standard.
5. **Demo-first distribution** — the 4-minute scenario (tree, challenge, refund, injection refusal,
   kill switch) is the artifact that travels: video, replay files, and the on-chain receipts.

**Path to mainnet (honest, gated).**

| Gate | Requirement | Why it blocks mainnet |
|---|---|---|
| G-Audit | External audit of `ChainworkEscrow`, `AgentAccount`, `BudgetGuardHook` and the payout paths, with the invariant suite extended to the audited build | it custodies other people's stablecoins |
| G-Token | A production stablecoin with the same EIP-3009/permit/ERC-1271 surface (or an adapter), not a testnet clone with an admin blacklist | tUSD8 is a testnet token |
| G-Evaluator | Bonded evaluators plus a verifier library, so a single trusted party is not the default for disputed jobs | evaluator trust is the largest assumption today |
| G-Ops | Multi-relayer facilitator with monitoring, alerting and a documented key-rotation and incident process | one hot key and one process is a demo posture |
| G-Legal | Terms, sanctions/blacklist handling, and a jurisdiction decision for taking fees | money transmission questions are real |
| G-Economics | A fee model that pays for gas, watchers and evaluators without breaking the "no new money in a tree" rule | fees must come from the root budget, not from children |

Until those gates pass, Chainwork is a testnet prototype. The repo will keep saying so.

## Docs, task board and red team

| Doc | What is in it |
|---|---|
| [AGENTS.md](AGENTS.md) | working rules, lanes, frozen files, quality bar |
| [docs/CONTEXT.md](docs/CONTEXT.md) | the only source of chain facts, addresses, faucets, open questions |
| [docs/TASKS.md](docs/TASKS.md) | the task board: every task, its acceptance command and status |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | component boundaries and where invariants I1–I7 are enforced and tested |
| [docs/DEMO_SCENARIOS.md](docs/DEMO_SCENARIOS.md) | S0–S5 scenarios, the demo task, canonical JSON, metrics function |
| [docs/DEMO_VIDEO_SCRIPT.md](docs/DEMO_VIDEO_SCRIPT.md) | the 4-minute recording script and checklist |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Aevum deploy, bytecode verification, fund split, Gate 1 (PowerShell) |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | 21 threats with the test that proves each, assumptions, red-team log |
| [docs/ERC8183.md](docs/ERC8183.md) | conformance and the deliberate deviations/extensions |
| [docs/X402_ESCROW_SCHEME.md](docs/X402_ESCROW_SCHEME.md) | the frozen wire contract for the `escrow` scheme and its x402 v2 gaps |
| [docs/DEEPSEEK_KICKOFF.md](docs/DEEPSEEK_KICKOFF.md) | onboarding for the second agent lane |
| [NOTICE](NOTICE) | third-party code, authors and licenses |

## License and attribution

MIT — see [LICENSE](LICENSE). Third-party code and specifications are listed in [NOTICE](NOTICE);
every borrowed snippet carries a comment naming its repo, author and license. Chainwork builds on the
ERC-8183 draft interface shapes (CC0), OpenZeppelin Contracts 5.1 (MIT), forge-std (MIT/Apache-2.0)
and Circle's stablecoin-evm FiatToken V2.2 (Apache-2.0), the last used only as compiled bytecode in
tests and on the local chain — never deployed to Aevum.
