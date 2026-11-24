# x402 `escrow` scheme on Aevum (spec v0.1)

**Status:** frozen for L3 (facilitator) and L2 (SDK). Owner: Claude (L0). Changes by PR.

Standard x402 `exact` pays the server *before* the response is seen. The `escrow` scheme keeps the x402 handshake but moves the money into `ChainworkEscrow` instead of to the server. The worker is paid only when its work is verified (verifier proof, unchallenged window, or evaluator decision). Deliverables are asynchronous: the paid request returns a job id, not the work.

> **Verified (T3.0, 2026-11-24):** the three headers (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`), `x402Version: 2` and the CAIP-2 network id were checked against the x402 v2 specification and its HTTP transport in [x402-foundation/x402](https://github.com/x402-foundation/x402). The header names are correct; several **field placements** below are v1-era and do not match v2. The differences and the proposed L0 edits are in [x402 v2 conformance](#x402-v2-conformance-t30-2026-11-24) at the end. Until that PR merges, the body of this document remains the wire contract for L2/L3.

## Roles

| Role | Who | Holds keys for |
|---|---|---|
| Client | the agent paying for work | signs one EIP-3009 `ReceiveWithAuthorization` |
| Worker (resource server) | the provider agent's HTTP API | its provider key (calls `acceptJob`, `submit`) |
| Facilitator | `services/facilitator` | a relayer key with tQDAY for gas; never holds tUSD8 |
| Escrow | `ChainworkEscrow` on Aevum | holds all budgets, bonds, challenge bonds |

## Flow

```
Client                      Worker API                    Facilitator                 Escrow (Aevum)
  | POST /jobs {task}          |                              |                            |
  |--------------------------->|                              |                            |
  | 402 PAYMENT-REQUIRED       |                              |                            |
  |   accepts[0].scheme=escrow |                              |                            |
  |<---------------------------|                              |                            |
  | sign ReceiveWithAuthorization(from=client,to=escrow,value=budget,nonce=termsHash)       |
  | POST /jobs + PAYMENT-SIGNATURE                            |                            |
  |--------------------------->| POST /verify ---------------->|                            |
  |                            | POST /settle ---------------->| fundWithAuthorization ---->|
  |                            |<----------- {jobId, txHash} --|                            |
  |                            | acceptJob (posts bond) ------------------------------------>|
  | 202 + PAYMENT-RESPONSE {jobId, txHash}                    |                            |
  |<---------------------------|                              |                            |
  | GET /jobs/{jobId}  (poll)  |  ... work, submit / submitWithProof ----------------------->|
```

## 402 response

Status `402`, header `PAYMENT-REQUIRED: base64(JSON EscrowPaymentRequired)` (type in `packages/types`). Body may repeat the JSON.

Required `extra` fields: `escrow, provider, evaluator, verifier, verifierSpec, challengeWindow, expiredAt, bond, creditLimit, worstCaseLoss, reputationScore, salt, descriptionHash`.

- `payTo` MUST equal `extra.escrow`. A client MUST refuse a quote where `payTo` is anything else.
- `bond` = `reputation.requiredBond(provider, amount)`; `creditLimit` = `reputation.creditLimit(provider)`; `worstCaseLoss` = `bond + creditLimit`, capped at `amount`. These are read from chain at quote time.
- `expiredAt` must be at least `challengeWindow + 120` seconds in the future.

## Client signature

The client builds `JobTerms` from the quote, computes `termsHash(client, terms)` (contract view, or locally per `TERMS_TYPE_STRING`), and signs EIP-712 `ReceiveWithAuthorization` on the tUSD8 domain `{name:"tUSD8", version:"2", chainId:44005, verifyingContract: tUSD8}` with `to = escrow`, `value = budget`, `nonce = termsHash`, `validBefore = now + maxTimeoutSeconds`.

Header on retry: `PAYMENT-SIGNATURE: base64(JSON EscrowPaymentPayload)`.

Because the nonce is the terms hash, the facilitator or worker cannot change provider, evaluator, verifier, budget, deadline or window: any change makes the signature invalid. Because `receiveWithAuthorization` requires `msg.sender == to`, nobody can front-run the signature into a plain transfer.

## Facilitator API

| Endpoint | Input | Does | Output |
|---|---|---|---|
| `GET /supported` | — | lists `{scheme:"escrow", network:"eip155:44005", asset}` | JSON |
| `POST /verify` | `{paymentPayload, paymentRequirements}` | recompute termsHash; check payload terms equal the requirements; check signature (EOA recover, or ERC-1271 `isValidSignature` via eth_call); check `authorizationState(client, termsHash) == false`; check client balance >= amount; check expiry sane | `{isValid, invalidReason?, payer}` |
| `POST /settle` | same | runs verify, then sends `fundWithAuthorization`; waits 1 confirmation | `EscrowSettleResponse {success, jobId, txHash}` |
| `POST /escrow/fund` | `EscrowPaymentPayload` only | same as settle, for callers without a 402 round-trip (agents hiring agents directly) | `EscrowSettleResponse` |
| `GET /jobs/{id}` | — | `getJob` + `getJobExt` + children via read views | JSON |

Errors use plain-English `invalidReason` strings (e.g. `"signature does not match these job terms"`, `"client has 0.02 tUSD8, needs 0.10"`).

## Worker obligations

1. After `/settle` succeeds, call `acceptJob(jobId, permitDeadline, permitSig)` before doing work.
2. Return `202` with `PAYMENT-RESPONSE: base64(EscrowSettleResponse)` and `{jobId}` in the body.
3. Deliver by `submit` / `submitWithProof` with `deliverable = keccak256(output bytes)`; serve the output at `GET /jobs/{id}/output` so watchers and evaluators can re-check it.

## Security notes

- The facilitator never holds tUSD8 and cannot redirect funds: `to` is the escrow and terms are bound by the nonce.
- Replays are impossible: tUSD8 marks the nonce used.
- A malicious quote (wrong `payTo`, absurd `bond`, `expiredAt` too soon) is rejected by the client SDK before signing.

## x402 v2 conformance (T3.0, 2026-11-24)

Checked against `specs/x402-specification-v2.md` (Protocol Version 2) and `specs/transports-v2/http.md` in [x402-foundation/x402](https://github.com/x402-foundation/x402/tree/main/specs).

| Item | x402 v2 | This document / `packages/types` (v0.1) | Verdict |
|---|---|---|---|
| HTTP headers | `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, each base64 JSON | same | **match** |
| Version / network | `x402Version: 2`; CAIP-2 `eip155:44005` | same | **match** |
| `PaymentRequired` | `{x402Version, error?, resource: ResourceInfo, accepts[], extensions?}`; `resource` is **required** | no top-level `resource`; `resource`/`description` sit inside every `accepts[]` entry | **differ** |
| `PaymentRequirements` | `{scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra?}` | also carries `resource` and `description` | **differ** (v1 leftovers) |
| `PaymentPayload` | `{x402Version, resource?, accepted: PaymentRequirements, payload, extensions?}` | top-level `scheme` and `network`, no `accepted` echo | **differ** |
| `VerifyResponse` | `{isValid, invalidReason?: code, invalidMessage?: text, payer?}` | `invalidReason` is a plain-English sentence | **differ** |
| `SettleResponse` | `{success, transaction, network, errorReason?, errorMessage?, payer?, amount?}` | `{success, jobId?, txHash?, network, errorReason?}` | **differ** |
| `GET /supported` | `{kinds: [{x402Version, scheme, network, extra?}], extensions: [], signers: {"eip155:*": [address]}}` | "lists `{scheme, network, asset}`" | **differ** |
| `/verify` and `/settle` request | `{x402Version: 2, paymentPayload, paymentRequirements}` | `{paymentPayload, paymentRequirements}` | **differ** |
| `extra.paymentFlow` | reserved protocol key. `escrow` means **two** settles: deposit/ceiling → resource → final charge | this scheme is also called `escrow`, but settles **once** up front and releases later on delivery | **naming collision** |

Why it matters:

1. A stock x402 v2 client switches on the **top-level** `resource` object and on `payload.accepted`; it will not parse the 402 below as v2, and a stock v2 facilitator will reject the payload as malformed.
2. x402 v2 clients MUST match `invalidReason` as a machine code (`insufficient_funds`, `invalid_network`, …) and MUST NOT match message text. Human text belongs in `invalidMessage`; `errorMessage` is the settle-side equivalent. Our current plain-English `invalidReason` is therefore in the wrong field.
3. x402 v2 clients read `transaction`, not `txHash`. A correct settle that omits `transaction` looks like a failure to them.
4. The reserved flow name `escrow` already means deposit-then-charge in x402 v2. Reusing it for Chainwork's single-settle, deliver-then-release scheme is legal as a scheme id but misleading about ordering.

### Proposed L0 edits (this PR)

1. `EscrowPaymentRequired`: add the required top-level `resource: {url, description, mimeType?}` and optional `extensions`.
2. `EscrowPaymentRequirements`: remove `resource` and `description`; keep scheme-specific fields (`escrow, provider, evaluator, verifier, verifierSpec, challengeWindow, expiredAt, bond, creditLimit, worstCaseLoss, reputationScore, salt, descriptionHash`) under `extra` as they already are.
3. `EscrowPaymentPayload`: replace the top-level `scheme`/`network` with `accepted: EscrowPaymentRequirements` (the exact requirements the client chose) and keep Chainwork's `payload: {client, terms, description, validAfter, validBefore, signature}`.
4. `EscrowSettleResponse`: rename `txHash` → `transaction`, add `payer`, keep `network`, and move the Chainwork-only `jobId` under `extensions: {chainwork: {jobId}}`. Add `errorMessage` for the plain-English text; `errorReason` becomes a code.
5. `/verify`: return a v2 code in `invalidReason` and the sentence in `invalidMessage`; keep `payer`.
6. `/supported`: return the v2 shape with `kinds: [{x402Version: 2, scheme: "escrow", network: "eip155:44005", extra: {asset}}]`, `extensions: []` and `signers: {"eip155:*": [relayer]}`.
7. `/verify` and `/settle` accept the v2 request envelope (`x402Version: 2` at the top).
8. Add `extra.paymentFlow: "upfront"` to every quote and state in §Security notes that release after delivery is outside the x402 request. Keeps the `escrow` scheme id (frozen) while telling v2 clients the money is committed before the resource runs.

### What L3 implements until the PR merges

Services keep the v0.1 wire contract above as canonical and **also accept the v2 spellings** where it costs nothing: a v2 request envelope, `paymentPayload.accepted` as an alias for `paymentRequirements`, and settle/verify responses that carry both `txHash` and `transaction` (and both plain-English `invalidReason` and `invalidMessage`). No money rule changes: the EIP-3009 nonce is still `termsHash`, so a v2-shaped request cannot alter terms.
