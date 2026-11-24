# Threat model

Scope: `ChainworkEscrow`, `ReputationRegistry`, `BudgetGuardHook`, `AgentAccount`, verifiers, the x402 escrow facilitator, and the agents. Every mitigation below names the test that proves it. Red-team findings are appended at the bottom as they are found (each one becomes a failing test first).

## Assets and trust

| Party | Trusted for | Not trusted for |
|---|---|---|
| Client (human owner) | Setting its own caps, sessions, kill switch | Anything about other clients' jobs |
| Client agent (LLM) | Choosing what to hire | **Moving money.** It holds only an AgentAccount session key scoped to "fund this escrow, within caps, until expiry" |
| Provider / coordinator | Doing the work | Releasing its own payment; holding funds; subcontracting beyond bond + earned credit |
| Evaluator | Deciding disputed or window-less jobs | It is a named party fixed in the signed terms. **Single point of trust for those jobs** (see Assumptions) |
| Verifier contract | Deterministic checks (`verify` is `view`) | — |
| Facilitator / relayer | Paying gas, submitting signatures | Changing terms (nonce = terms hash), redirecting funds (`to` = escrow, `receiveWithAuthorization` requires `msg.sender == to`), holding funds |
| Watcher | Re-running checks and challenging | Winning a challenge without the evaluator; a failed challenge costs its bond |
| tUSD8 (FiatToken V2.2) | Token accounting, EIP-3009, ERC-1271 checks | — |

## Threats and mitigations

| # | Threat | Mitigation | Proof |
|---|---|---|---|
| T1 | Relayer/facilitator alters job terms (provider, budget, deadline, verifier) after the client signs | EIP-3009 nonce = `termsHash(client, terms)` incl. chain id and escrow address | `test_tamperedTerms_reverts`, `test_tamperedBudget_reverts` |
| T2 | Signature replay | tUSD8 marks the authorization nonce used | `test_replay_reverts` |
| T3 | Front-running the funding signature into a plain transfer | `receiveWithAuthorization` only callable by `to` (the escrow) | FiatToken V2.2 semantics; fixture-based tests |
| T4 | Prompt-injected client agent pays an attacker | Agent holds only a session key; AgentAccount accepts session signatures only for `ReceiveWithAuthorization` to the escrow with re-derived terms; raw 65-byte signatures must be the owner's | `test_promptInjectedTransferToAttackerRefused` |
| T5 | Agent exceeds budget | Session per-job cap + daily cap (read from BudgetGuard) + BudgetGuard per-job/per-day caps + kill switch | `test_sessionOverPerJobCapRejected`, `test_sessionDailyCapReadsGuard`, `test_perJobPerDayAndFreeze` |
| T6 | Stolen or leaked session key | Expiry, owner revoke, owner freeze; scope limits blast radius to "fund jobs at most daily cap" | `test_revokeAndFreeze`, `test_expiredSessionRejected` |
| T7 | Malicious HTTP quote (wrong `payTo`, absurd bond, deadline too short, different task) | SDK `checkQuote` refuses before signing | SDK unit tests "checkQuote" |
| T8 | Worker delivers garbage | Verifier proof, or optimistic window with bonded challenges; evaluator rejects → refund + bond slashed to the payer | `test_rejectSlashesBondToClient`, `test_childFailurePaysBondToCoordinatorAndAllowsRehire` |
| T9 | Worker accepts and ghosts | Expiry refund by anyone; accepted-but-not-delivered bond slashed to payer | `test_ghostingProviderIsSlashedAtExpiry` |
| T10 | Client tries to dodge paying for delivered work at expiry | `claimRefund` finalizes a submitted, unchallenged job whose window passed instead of refunding | `test_honestProviderNotRobbedAtExpiry` |
| T11 | Window ends after the deadline, creating a race between finalize and refund | Submit requires `now + window < expiredAt` | `test_submitTooLateForWindowReverts` |
| T12 | Coordinator subcontracts beyond what it can cover | Allocated ≤ bond + reputation credit; allocated ≤ budget | `test_newAgentCannotSubcontractBeyondBondPlusCredit`, invariant I2 |
| T13 | Coordinator submits or is paid before children settle | Parent submit/complete/reject require `openChildren == 0` | `test_zeroCapitalTreeSettlesInOneTransaction`, invariant I4 |
| T14 | A hook blocks refunds forever | `claimRefund` is not hookable; children always expire before parents | `test_parentExpiryWaitsForChildrenThenRefunds` |
| T15 | Funds stuck or created from nothing | Escrow balance = open root budgets − paid-to-children + bonds + challenge bonds, after every action | invariant I1 (16,384 random calls × 256 runs) |
| T16 | Griefing challenges | Challenger posts 10% bond; it goes to the provider if the challenge fails | `test_failedChallengePaysProvider` |
| T17 | Reentrancy through hooks, verifiers or tokens | `nonReentrant` on every state-changing escrow function; verifier is `view` | code review; tests |
| T18 | Reputation farming (self-dealing jobs) | Reputation only from settled jobs, weighted by value; credit capped at 1 tUSD8; slashes cost 2× | `ReputationRegistry` constants; see Assumptions |
| T19 | Unbounded loops (gas DoS) | Depth 1, ≤ 4 open and ≤ 8 total children, page size ≤ 100 | code; `test_noGrandchildren` |
| T20 | Wrong EVM target (Aevum has no Cancun opcodes) | `evm_version = "shanghai"`, verified by opcode probing on chain | `docs/CONTEXT.md` |
| T21 | Keys leaked from the repo | No keys in git; agents load encrypted keystores; CI has no secrets | `.gitignore`, pre-submit checklist |

## Assumptions and limitations (stated honestly in the README)

- **Evaluator trust.** For window-less jobs and challenged jobs the evaluator decides. It is fixed in the terms the client signs, so the client chooses whom to trust. Deterministic checks should use a verifier contract instead. Roadmap: bonded evaluators and ERC-8004 validation registries when QDay opens them.
- **Self-dealing reputation.** An agent can pay itself through a second wallet to build reputation. It costs real tUSD8 per job, credit is capped at 1 tUSD8, and the bond curve needs 5 completed jobs to reach 0. Roadmap: weight reputation by distinct counterparties and by client reputation.
- **Credit risk is real.** If a coordinator with credit fails after its children completed, the client pays for those children. The loss is bounded by bond + credit and shown in the quote as `worstCaseLoss` before the client signs.
- **Depth 1 trees.** Children cannot subcontract further. This keeps gas and invariants simple.
- **Testnet token.** tUSD8 is a FiatToken V2.2 clone with an admin and a blacklist; a blacklisted address cannot be paid.

## Red-team findings

| Date | Finder | Finding | Fix | Test |
|---|---|---|---|---|
| 2026-11-24 | Claude (while testing) | AgentAccount counted the current job twice for the daily cap: the escrow's fund hook adds it before tUSD8 asks the account to validate | Check `spentToday <= dailyCap` (already includes this job) | `test_sessionDailyCapReadsGuard` |
| 2026-11-24 | Claude (while testing) | SDK receipts could miss the final payout: viem caches the block number ~4 s | Read the block number with `cacheTime: 0` | SDK e2e receipt assertion |
