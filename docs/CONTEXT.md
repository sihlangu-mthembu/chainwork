# CONTEXT.md — Aevum ground truth

**Rule for every agent (Claude and DeepSeek):** use only chain facts from this file or `packages/types`. If you need a fact that is not here, add it to "Open questions" and stop that task; never guess an address, selector, endpoint or domain value.

Last verified: 2026-11-24 (live eth_call against rpc-test.qday.info unless marked otherwise)

## Network

| Item | Value | Status |
|---|---|---|
| Chain ID | 44005 (0xabe5) | verified live |
| RPC | https://rpc-test.qday.info | verified live |
| WebSocket | wss://rpc-test.qday.info | from qday.io/build, untested |
| Client | `cdk-erigon/2.0-qday-v2.61.19-validium` (Polygon CDK validium) | verified live (web3_clientVersion) |
| Explorer | https://explorer-test.qday.info (Blockscout, API at /api/v2/) | verified |
| Gas token | tQDAY, 18 decimals | qday.io/build |
| Gas price | 1 gwei | verified live |
| Block time | ~1.0 s measured over 1,000 blocks (QDay reported 3.02 s in Oct). **Use timestamps, never block counts.** | verified live |
| eth_getLogs max range | **1,000 blocks** ("block range too large, max range: 1000") | verified live |

## EVM version (critical for every contract)

Verified by simulating contract creation with each opcode:

| Opcode | Fork | Aevum |
|---|---|---|
| PUSH0 | Shanghai | supported |
| BASEFEE, CHAINID | London / Istanbul | supported |
| MCOPY | Cancun | **invalid opcode** |
| TSTORE / TLOAD | Cancun | **invalid opcode** |
| BLOBBASEFEE | Cancun | **invalid opcode** |

Rules:
- `foundry.toml` sets `evm_version = "shanghai"`. Solidity >= 0.8.25 defaults to cancun and can emit MCOPY, which reverts on Aevum.
- No transient storage; no OpenZeppelin `ReentrancyGuardTransient`. Use the classic `ReentrancyGuard`.
- Pinned: solc 0.8.28, optimizer on, 200 runs (needed for reproducible bytecode checks).

## tUSD8 (the only stablecoin we use)

| Item | Value |
|---|---|
| Proxy (use this) | `0x456569838f1d43009A91ebA4263147Afd7233483` |
| Implementation | `0xD6bE708F41b07b2F4A7B48889b8e16626e317597` (Circle FiatTokenV2_2 clone, solc 0.6.12) |
| name() | `tUSD8` |
| version() | `2` |
| decimals() | 6 |
| DOMAIN_SEPARATOR() | `0x7838e6c46f8f9874236c9747d9896552a03d22c7c3e701b198879de2cb658022` (= EIP-712 domain {name:"tUSD8", version:"2", chainId:44005, verifyingContract: proxy}) |
| TRANSFER_WITH_AUTHORIZATION_TYPEHASH | `0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267` (standard EIP-3009) |

Functions confirmed in the implementation bytecode:

| Function | Selector | Notes |
|---|---|---|
| transferWithAuthorization(...,uint8 v,bytes32 r,bytes32 s) | 0xe3ee160e | EOA signatures |
| transferWithAuthorization(...,bytes signature) | 0xcf092995 | EOA or ERC-1271 smart-contract signer |
| receiveWithAuthorization(...,bytes signature) | 0x88b7ab63 | **used by Chainwork**; caller must be `to`; front-run safe; ERC-1271 aware |
| cancelAuthorization(address,bytes32,bytes) | 0xb7b72899 | |
| permit(address,address,uint256,uint256,bytes) | 0x9fd5a6cf | **used for bonds**; ERC-1271 aware |
| nonces / authorizationState / DOMAIN_SEPARATOR / version | present | |

FiatToken quirks: blacklist exists (`isBlacklisted`); EIP-3009 nonces are arbitrary bytes32 (Chainwork uses the job terms hash); `validAfter` and `validBefore` are both exclusive.

## Account abstraction (ERC-4337) — stretch only

| Item | Value | Status |
|---|---|---|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | code present (verified) |
| EntryPoint v0.6 | — | **no code** |
| Kernel v3.1 factory | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` | code present; reported by another entry as **not staked** |
| Kernel ECDSA validator | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` | code present |
| Bundler | bundler.qday.info (rundler fork) | reported by another entry; untested by us (browser CORS blocked) |
| Paymaster | none published | |

## Other

| Item | Value | Status |
|---|---|---|
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | code present |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | code present |
| Permit2 | — | **no code**: do not use |
| QDayFaucet | `0xE5074CBbd046AFb491EB8692abD6cF7ECCC6dEE5` | official links |
| x402 facilitator | QDay says live; **no public endpoint published**. We ship our own (`services/facilitator`) | |
| ERC-8004 registries | not open for this challenge | do not depend on it |
| Contract verification | explorer reportedly can't verify source → `scripts/verify-bytecode.sh` | |

## Faucets
- https://faucet.qday.info/en: 5 tQDAY per recipient per 24 h; **tUSD8 tab: 1 tUSD8 per 24 h**. Both require the recipient to hold ETH, USDT or USDC on Ethereum mainnet (Cloudflare Turnstile protected). Fresh wallets are not eligible.
- Discord `/faucet` in #faucet: 1 tQDAY + 5 tUSD8 (verified members)
- Implication: demo prices are cents (0.03–0.10 tUSD8).

## Challenge rules that affect code
- Settlement must be on Aevum testnet (not Base).
- Core build inside Nov 16 – Dec 11. Adding tUSD8 to an existing product does not count.
- Borrowed code: keep license headers, comment above each snippet (repo, author, license), list in NOTICE.
- DoraHacks submission requires a GitHub link **and a demo video**. Deadline 2026-12-11 08:00 UTC. Demo Day 2026-12-15 06:00 UTC, live only.

## Wallets (addresses only — keys live in local .env)
| Role | Address |
|---|---|
| deployer / facilitator relayer | `0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1` |
| client | `0xbE213deEEf489afDf67842F411472Aa90f8f8D77` |
| coordinator (keep at 0 tUSD8) | `0x28C0B52FAd3Ce860324C3DA7DfDdcD7b94cEA40A` |
| specialist-data | `0xa5130D2A006d13750Fbc2E7b66cad6Cb9ad9B5c3` |
| specialist-bad | `0x80Dec5f266418EB8ae26A6C2Ee592c9082E4c00d` |
| backup | `0x7117c6741d15f794751C447Df5F96F48501D1DA9` |
| watcher | `0xFCEB78c36c369d0C90a6c91d4498A1991Ed036bd` |
| evaluator | `0x6024AaEC247E11c53c9799ED018D67Ee2B5373e4` |

## Open questions
- [x] Starter kit = 8-page PDF guide (no code). Judging wording saved in the OneDrive reference folder; key asks: smart accounts, scoped sessions, budgets, expiry; retries/idempotency; secure key storage; revocation controls; assumptions/limitations/roadmap in README.
- [ ] Bundler reachable from a server, and which EntryPoint it serves
- [ ] Sourcify support for chain 44005
- [ ] Public QDay x402 facilitator endpoint, if any
