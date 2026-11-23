# AGENTS.md — rules for every coding agent (Claude and DeepSeek)

Read this file, then `docs/CONTEXT.md`, then your lane in `docs/TASKS.md`, before writing any code.

## Ground truth
1. Chain facts (addresses, selectors, chain id, limits) come **only** from `docs/CONTEXT.md` or `packages/types`. Never guess an address or invent an endpoint. Missing fact → add it to "Open questions" in CONTEXT.md and stop that task.
2. Aevum has **no Cancun opcodes**. Solidity compiles with `evm_version = "shanghai"`, solc 0.8.28, optimizer 200 runs. No transient storage, no `ReentrancyGuardTransient`.
3. Money is tUSD8 (6 decimals). Demo amounts are cents: write `100_000` for 0.10 tUSD8.

## Frozen files (L0)
`interfaces/*.sol`, `packages/types/src/index.ts`, `packages/types/abi/*.json`, `docs/X402_ESCROW_SCHEME.md`.
Do not edit them in a lane task. If one is wrong, open a PR titled `L0: <change>` that both lanes review; the human merges.

## Lanes and ownership
| Lane | Owner | Folders |
|---|---|---|
| L0 Spec | Claude | `interfaces/`, `packages/types/`, `docs/` (spec files) |
| L1 Contracts | Claude | `contracts/` |
| L2 SDK | Claude | `packages/sdk/` |
| L3 Services | DeepSeek | `services/` |
| L4 Agents | DeepSeek (failure scenarios by Claude) | `apps/agents/` |
| L5 Dashboard | DeepSeek | `apps/dashboard/` |
| L6 Docs, Docker | DeepSeek drafts, Claude edits; `scripts/verify-bytecode.sh` by Claude | `README.md`, `docker-compose.yml`, `docs/` (non-spec), `scripts/` |
| L7 Red team | Cross | `contracts/test/redteam/`, `services/**/redteam/` |

Touch only your lane's folders. Need something from another lane → add a task to `docs/TASKS.md` under that lane with status `requested`.

## How to work a task
1. Set its status in `docs/TASKS.md` to `in-progress` with your name (`claude` or `deepseek`).
2. Write the test or acceptance command first if there is none.
3. Done = the task's acceptance command passes locally, CI is green, status set to `done` with the commit hash.
4. One task per commit where possible. Commit message: `T<id>: <what>`.

## Never
- Commit private keys, `.env`, API keys or mnemonics. Use `.env.example` with placeholder values.
- Let an LLM decision move money. Agents may only call escrow functions; release happens by verifier, window or evaluator.
- Copy code without attribution: keep license headers, add a comment above each borrowed snippet with repo, author and license, and list it in `NOTICE` (challenge rule).
- Use Base, Sepolia or any chain other than Aevum (44005) for anything shown as project traffic.
- Query `eth_getLogs` over more than 1,000 blocks. Use the escrow read views, or page in 500-block chunks.

## Quality bar
- TypeScript: strict mode, viem, no `any` in exported APIs, errors decoded to plain English.
- Solidity: custom errors, checks-effects-interactions, `ReentrancyGuard` on every token-moving function, NatSpec on externals.
- Every money path has a test. Every red-team finding becomes a failing test before its fix.
