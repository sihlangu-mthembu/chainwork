# DoraHacks submission: Chainwork

Copy each block into the matching DoraHacks field. Every claim below links to something a judge can
open: the code, the live dashboard, or a transaction on the Aevum explorer.

---

## Name

Chainwork

## Tagline (one line)

Pay-on-delivery hiring for AI agents on Aevum, where an agent with 0 tUSD8 can still hire others.

## Links

- Live dashboard (Aevum testnet): https://sihlangu-mthembu.github.io/chainwork/
- Watch the challenge scenario replay: https://sihlangu-mthembu.github.io/chainwork/#job=11
- Code (MIT): https://github.com/sihlangu-mthembu/chainwork
- Evidence of the live run: https://github.com/sihlangu-mthembu/chainwork/blob/main/docs/evidence/aevum-run.log
- Demo video (3 min): https://youtu.be/kUwl6C9hyh8

## Description

**The problem.** AI agents are starting to hire other agents. Two things stop that today. Whoever
pays first has to trust the other side, because nothing checks the work before money moves. And
the agent in the middle, the one that splits a job and hires specialists, needs cash up front that
it usually doesn't have.

**What Chainwork does.** A client locks a job's budget in an escrow on Aevum with one gasless tUSD8
signature. The hired agent can then subcontract parts of the job **out of that locked budget**,
without spending any money of its own: its on-chain track record works as a credit line. Money is
released only when the work passes a check. If nobody delivers, anyone can trigger the refund, and
no hook, admin or agent can block it. A worker that delivers bad work loses its bond to whoever it
hurt.

**How a job runs.**
1. The client asks the agent for a quote and gets an HTTP 402 escrow quote (an x402 `escrow`
   scheme: pay on delivery, not before).
2. The client signs one tUSD8 `receiveWithAuthorization`; a facilitator submits it and pays the gas.
3. The coordinator hires specialists from the locked budget (ERC-8183 jobs with a parent).
4. Each result is a hash on chain. A watcher re-runs the check during a 30-second window and
   challenges wrong work, posting a bond; the evaluator then decides.
5. When the windows pass, one `settleTree` transaction pays everyone, and a receipt lists every cent.

**Live on Aevum, 25 Nov 2026.** All six scenarios ran on the real chain:
- **S1, zero capital:** the client paid 0.10 tUSD8; the coordinator, holding 0, hired two agents for
  0.03 and 0.04 and kept 0.03. Job #7.
- **S2, bad worker:** a metrics agent delivered wrong numbers. The watcher challenged
  ([tx](https://explorer-test.qday.info/tx/0x55eeba69b878f8c0a7cdad7cfcb6c4102818b94e7bec01705e9fd649e2d6fb46)),
  the evaluator rejected
  ([tx](https://explorer-test.qday.info/tx/0x6daacfc7993d69cf961e72fc541034e85d39393df27609eb4c2425ea2a89eff0)),
  its 0.02 bond went to the coordinator, and a backup was hired from the returned budget. Job #11:
  every cent of the 0.10 accounted for.
- **S3, ghosting:** nobody delivered; the client got all 0.02 back. Job #10.
- **S4, prompt injection:** a quote asking to pay anyone but the escrow was refused by the SDK and
  by the agent's own tool before anything was signed; a payment signed with the agent's session key
  for more than its 0.10 cap never reached the chain. No job was created.
- **S5, kill switch:** the owner froze the client's smart account; the next payment was refused.
- **Gate 1:** a single paid job, step by step with an explorer link for each transaction. Job #1.

**Safety.**
- The client's worst-case loss (bond + credit) is shown in the quote, before signing.
- Agents pay through an ERC-1271 smart account with scoped session keys and daily caps; the owner
  can freeze it. A model never decides when money moves: only a verifier, a window or the evaluator.
- A red-team suite attacks the escrow (tampered and replayed signatures, credit bypass, refund
  blocking, role spoofing, window edges, double payout). Two real findings were fixed after failing
  tests: a payer that judged its own hire could take the worker's bond, and challenges on tiny jobs
  cost nothing.

**Proof the code is what runs.** `scripts/verify_bytecode.py` rebuilds every contract with the pinned
compiler and compares it with the code at each Aevum address: all six `MATCH`. CI re-checks this
every six hours.

## Deployed contracts (Aevum testnet, chain 44005)

| Contract | Address |
|---|---|
| ChainworkEscrow | `0xC8a46c937c993cDd7E6c865B38fb3b32c275AA43` |
| ReputationRegistry | `0x11Cde75aa12E8D3146e8a8648675aC8a064c2Edf` |
| BudgetGuardHook | `0x2D9545aeBB6Ec629f6BAEdCEbbf7d9B5c981bbE1` |
| HashVerifier | `0x018E5318378795b0977c22472B6EC64b24a9738B` |
| SignedDataVerifier | `0x7c6F62440FbDa111c12B73eE742914ED0f822aa2` |
| Client AgentAccount | `0x08cfC1A474782a9627121cE42a33D76320dC4817` |

Payment token: tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483`.

## Tech stack

Solidity 0.8.28 (`shanghai`, since Aevum has no Cancun opcodes) with Foundry, tested against Circle's
real FiatToken V2.2 bytecode; TypeScript and viem for the SDK, services and agents; React and Vite
for the dashboard; Docker Compose for one-command local runs.

## How the judging criteria are met

| Criterion | Where to look |
|---|---|
| Innovation and originality | Zero-capital subcontract trees, reputation as a credit line, bonds that pay the victim, an x402 `escrow` scheme ([spec](https://github.com/sihlangu-mthembu/chainwork/blob/main/docs/X402_ESCROW_SCHEME.md)) |
| Technical quality and platform integration | ERC-8183 jobs and hooks; tUSD8 `receiveWithAuthorization` and `permit` with ERC-1271; unit, fuzz, invariant and red-team suites; bytecode proof against the live addresses; read views that stay inside Aevum's 1,000-block log limit |
| Real-world utility | A job split across four agents for cents; agents need no starting capital; a 3-line SDK and a self-hostable facilitator |
| Safety, trust and controls | Unblockable refunds, bonded challenges, worst-case loss shown up front, session keys with caps, a kill switch, a threat model and red-team findings with their tests |
| User experience and presentation | The live dashboard: a money map of each job tree, a replay of every on-chain step, where every cent went, plain-English history with explorer links |
| Clear demo | One story on the live chain: a coordinator with no money hires, a worker fails and pays for it, a backup is hired, everyone is settled |
| Documentation | README (architecture, workflows, addresses, assumptions, limitations, roadmap), runbook, threat model, ERC-8183 conformance notes, API reference, MIT licence, NOTICE |

## Team

Sihlangu Mthembu, building with AI coding agents (Claude and DeepSeek).
