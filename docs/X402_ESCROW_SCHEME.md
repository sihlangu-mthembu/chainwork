# x402 `escrow` scheme on Aevum (spec v0.1)

**Status:** frozen for L3 (facilitator) and L2 (SDK). Owner: Claude (L0). Changes by PR.

Standard x402 `exact` pays the server *before* the response is seen. The `escrow` scheme keeps the x402 handshake but moves the money into `ChainworkEscrow` instead of to the server. The worker is paid only when its work is verified (verifier proof, unchallenged window, or evaluator decision). Deliverables are asynchronous: the paid request returns a job id, not the work.

> **Verify before implementing (L3 task T3.0):** header names and field names below follow x402 v2 as used by other Aevum entries (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, network `eip155:44005`). Check them against the current spec at https://github.com/x402-foundation/x402 and record any difference here before writing code.

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
