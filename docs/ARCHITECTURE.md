# Architecture

One page: what each component may do, and where the escrow's money rules are enforced and tested.
Chain facts and addresses live in [CONTEXT.md](CONTEXT.md); the wire contract for payments lives in
[X402_ESCROW_SCHEME.md](X402_ESCROW_SCHEME.md) (frozen); the job model is
[ERC8183.md](ERC8183.md).

## Component boundaries

| Component | Code | May do | May **not** do | Trusted for |
|---|---|---|---|---|
| `ChainworkEscrow` | [contracts/src/ChainworkEscrow.sol](../contracts/src/ChainworkEscrow.sol) | hold tUSD8 budgets, bonds and challenge bonds; release on the three paths; route slashed bonds; record outcomes | be upgraded, be paused, charge a fee, be administered | all money accounting |
| `ReputationRegistry` | [contracts/src/ReputationRegistry.sol](../contracts/src/ReputationRegistry.sol) | price bonds (`bondBps`, `requiredBond`) and subcontract credit (`creditLimit`) from settled outcomes | accept writes from anyone but the escrow; take ratings | the bond/credit curve |
| `BudgetGuardHook` | [contracts/src/BudgetGuardHook.sol](../contracts/src/BudgetGuardHook.sol) | enforce a client's per-job cap, per-day cap and freeze, as an ERC-8183 `fund` hook | be set by anyone but that client | spend accounting for sessions |
| `AgentAccount` | [contracts/src/AgentAccount.sol](../contracts/src/AgentAccount.sol), [interfaces/IAgentAccount.sol](../interfaces/IAgentAccount.sol) | validate ERC-1271 signatures from owner or a scoped session key | let a session fund anything but the escrow, over caps, past expiry, or while frozen | client key custody |
| Verifiers | [contracts/src/verifiers/](../contracts/src/verifiers/) | `view`-only deterministic checks (`HashVerifier`, `SignedDataVerifier`) | move funds, be non-deterministic | their own check |
| SDK | [packages/sdk/](../packages/sdk/) | build terms, sign, quote-check, submit transactions, read trees, build receipts, decode errors | hold funds; release money | nothing (client-side) |
| Facilitator | [services/facilitator/](../services/facilitator/) | verify a client signature, pay gas, submit `fundWithAuthorization`, read jobs | alter terms (nonce = terms hash), redirect funds (`to` = escrow), hold tUSD8 | liveness of gasless funding only |
| Service kit | [services/kit/](../services/kit/) | config, keystore relayer, SQLite, retries, quote building | sign arbitrary payloads for users | shared plumbing |
| Indexer (planned, T3.2) | `services/indexer` | page escrow events in ≤500-block chunks into SQLite | request >1,000 blocks per `eth_getLogs` | event history |
| Watcher (planned, T3.3) | `services/watcher` | re-run a job's check, `challenge` with a bonded stake | release funds, challenge without a bond | its re-check |
| Evaluator (planned, T3.4) | `services/evaluator` | `complete`/`reject` challenged or window-less jobs | act on jobs where it is not the named evaluator | disputed decisions |
| Worker kit (planned, T3.5) | `services/worker-kit` | answer 402, accept a funded job, serve output | price its own bond/credit (read from chain) | its output |
| Agents (planned, T4.x) | `apps/agents` | choose whom to hire, split work, write the summary | move money: no tool takes an arbitrary recipient and amount | decisions, not payments |
| Dashboard (planned, T5.x) | `apps/dashboard` | read views, owner actions (add/revoke session, freeze, set limits) | sign with any key the owner did not connect | nothing |

Boundary rule: **off-chain code can only ask.** Every state change that moves value is an escrow
function with an on-chain permission check. The facilitator and relayer cannot change a term; the
watcher cannot win a challenge without the evaluator; the evaluator cannot touch a job it is not named
in; the client agent holds no key that reaches an arbitrary address.

## Money-flow invariants (I1–I7)

The statements are verbatim from [interfaces/IChainworkEscrow.sol](../interfaces/IChainworkEscrow.sol).
Line numbers are in the current sources; test names are the repository's own — the acceptance command
that proves them is on [TASKS.md](TASKS.md).

| # | Invariant | Enforced by | Tested by |
|---|---|---|---|
| **I1** | `tUSD8.balanceOf(escrow) == sum(unsettled root budgets) + sum(posted bonds) + sum(challenge bonds)` | every transfer goes through `fundWithAuthorization` ([223–247](../contracts/src/ChainworkEscrow.sol#L223-L247)), `_complete` ([530–566](../contracts/src/ChainworkEscrow.sol#L530-L566)) and `_fail` ([581–624](../contracts/src/ChainworkEscrow.sol#L581-L624)), which zero `bond`/`challengeBond` before paying out | `invariant_I1_moneyConserved` ([Invariants.t.sol:209](../contracts/test/invariant/Invariants.t.sol#L209)), `test_zeroCapitalTreeSettlesInOneTransaction` ([Escrow.t.sol:170](../contracts/test/Escrow.t.sol#L170)) |
| **I2** | for every parent: `sum(child budgets still allocated) <= parent.budget` | `createSubJob` computes `available = budget - allocated` and refuses more ([326–327](../contracts/src/ChainworkEscrow.sol#L326-L327)); refunds decrement `allocated` ([594](../contracts/src/ChainworkEscrow.sol#L594)) | `invariant_I2_treeBookkeeping` ([Invariants.t.sol:224](../contracts/test/invariant/Invariants.t.sol#L224)); SDK e2e expects `ChildBudgetTooHigh` ([packages/sdk/test/local.test.ts:75](../packages/sdk/test/local.test.ts#L75)) |
| **I3** | at subcontract time: `parent.allocated <= parent.bond + reputation.creditLimit(provider)` | `createSubJob` limit check ([328–330](../contracts/src/ChainworkEscrow.sol#L328-L330)); `maxSubcontract` exposes the same number to UIs ([470–478](../contracts/src/ChainworkEscrow.sol#L470-L478)) | `test_newAgentCannotSubcontractBeyondBondPlusCredit` ([Escrow.t.sol:238](../contracts/test/Escrow.t.sol#L238)) |
| **I4** | a parent cannot submit, complete or finalize while `openChildren > 0` | `_checkSubmittable` ([486–493](../contracts/src/ChainworkEscrow.sol#L486-L493)), `reject` ([186](../contracts/src/ChainworkEscrow.sol#L186)), `settleTree` only closes a root once `openChildren == 0` ([412](../contracts/src/ChainworkEscrow.sol#L412)) | `invariant_I4_parentWaitsForChildren` ([Invariants.t.sol:248](../contracts/test/invariant/Invariants.t.sol#L248)), `test_zeroCapitalTreeSettlesInOneTransaction` ([Escrow.t.sol:170](../contracts/test/Escrow.t.sol#L170)) |
| **I5** | `claimRefund` cannot be blocked by any hook or role (children expire before parents) | `claimRefund` has no role check and never runs `_before`/`_after` ([197–208](../contracts/src/ChainworkEscrow.sol#L197-L208)); a parent waits for children ([206](../contracts/src/ChainworkEscrow.sol#L206)) and a child must expire earlier ([323](../contracts/src/ChainworkEscrow.sol#L323)) | `test_parentExpiryWaitsForChildrenThenRefunds` ([Escrow.t.sol:269](../contracts/test/Escrow.t.sol#L269)), `test_ghostingProviderIsSlashedAtExpiry` ([Escrow.t.sol:123](../contracts/test/Escrow.t.sol#L123)), `test_expiryWithoutAcceptRefundsWithoutSlash` ([Escrow.t.sol:111](../contracts/test/Escrow.t.sol#L111)) |
| **I6** | a slashed bond goes only to the payer of the failed job (root: client; child: parent provider) | `_fail` sets `payer = j.client` for both depths — for a child, `j.client` **is** the parent's provider — and sends the bond there only when slashing ([586–597](../contracts/src/ChainworkEscrow.sol#L586-L597), [611–618](../contracts/src/ChainworkEscrow.sol#L611-L618)) | `test_rejectSlashesBondToClient` ([Escrow.t.sol:98](../contracts/test/Escrow.t.sol#L98)), `test_childFailurePaysBondToCoordinatorAndAllowsRehire` ([Escrow.t.sol:210](../contracts/test/Escrow.t.sol#L210)) |
| **I7** | funds are released only by: evaluator decision, verifier proof, or an unchallenged window | `complete`/`reject` require `msg.sender == evaluator` ([161–192](../contracts/src/ChainworkEscrow.sol#L161-L192)); `submitWithProof` requires a `view` verifier to return true ([361–369](../contracts/src/ChainworkEscrow.sol#L361-L369)); `finalize`/`_tryClose` require an unchallenged, elapsed window ([394–414](../contracts/src/ChainworkEscrow.sol#L394-L414), [502–526](../contracts/src/ChainworkEscrow.sol#L502-L526)) | `test_windowFinalizePaysProviderAndReturnsBond` ([Escrow.t.sol:82](../contracts/test/Escrow.t.sol#L82)), `test_hashVerifierCompletesInstantly` ([Escrow.t.sol:326](../contracts/test/Escrow.t.sol#L326)), `test_signedDataVerifierNeedsOracleSignature` ([Escrow.t.sol:338](../contracts/test/Escrow.t.sol#L338)), `test_onlyEvaluatorDecides` ([Escrow.t.sol:313](../contracts/test/Escrow.t.sol#L313)) |

Two accounting details worth knowing when reading those functions:

- A child is paid on **its own** verification. If the root later fails, the client loses only
  `budget - paidToChildren`; completed children are never clawed back (that is the credit risk the
  quote shows as `worstCaseLoss`).
- `claimRefund` on a `Submitted` job whose unchallenged window already passed **finalizes** it
  instead of refunding ([201–204](../contracts/src/ChainworkEscrow.sol#L201-L204)), so expiry cannot
  be used to rob an honest provider.

## Cross-cutting boundaries

| Boundary | Rule | Where |
|---|---|---|
| EVM target | shanghai only: no `MCOPY`, `TSTORE`/`TLOAD`, `BLOBBASEFEE`; classic `ReentrancyGuard` | [foundry.toml](../foundry.toml), [CONTEXT.md](CONTEXT.md) |
| Log range | never `eth_getLogs` over >1,000 blocks; page 500 | [packages/sdk/src/tree.ts](../packages/sdk/src/tree.ts), `getJobsPage` in the escrow |
| Reentrancy | `nonReentrant` on every state-changing escrow function; verifiers are `view` | [ChainworkEscrow.sol](../contracts/src/ChainworkEscrow.sol) |
| Frozen files | `interfaces/`, `packages/types/src/index.ts`, `packages/types/abi/*`, [X402_ESCROW_SCHEME.md](X402_ESCROW_SCHEME.md) — changes only by reviewed `L0:` PR | [AGENTS.md](../AGENTS.md) |
| Keys | no key in git; services load V3 keystores; raw keys local-only | [.gitignore](../.gitignore), [.env.example](../.env.example), [RUNBOOK.md](RUNBOOK.md) |

## Who notices a failure

| Failure | Detected by | Recovery |
|---|---|---|
| Bad deliverable, inside the window | watcher re-check → `challenge` | evaluator `reject`; provider bond to the payer; coordinator re-hires |
| Bad deliverable, after the window | nobody on-chain (optimistic finality) | reputation records the outcome only when a check fails; a client that needs certainty must use a verifier or a window-longer-than-review |
| Provider ghosts | anyone, at expiry | `claimRefund` — no admin, no hook, bond slashed to the payer |
| Coordinator cannot cover children | quote time | `worstCaseLoss` in the 402 quote, enforced by I3 |
| Relayer down | `/health`, failed `/settle` | anyone can submit the same signature directly; it stays valid until `validBefore` |
| Client key leak | owner, in the dashboard or by `revokeSession`/`setFrozen` | sessions expire; freeze stops the next funding attempt |
