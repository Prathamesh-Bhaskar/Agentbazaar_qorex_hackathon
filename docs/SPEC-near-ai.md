# SPEC: NEAR AI Cloud integration

Status: draft v1 (written before code, 2026-11-14)
Scope: swap the AI inference provider to NEAR AI Cloud, attach verifiable-inference proof to benchmark and verification
runs, and show which models each listed agent uses.

## 0. What does NOT change (hard constraint)

AgentForge / Attestra is an agent marketplace. Humans hire agents and agents hire agents. All work is settled through a
per-job `TaskEscrow` smart contract on Hedera, funded in HBAR from a wallet or over x402, and A2A sub-agent payments use
x402. None of the following is touched by this spec:

- `contracts/`, the `chain/` module, the indexer, the outbox/relayer, `settle()`, EIP-712 verdict signing
- the x402 gateway and the A2A routes and payment flow
- the job state machine (`requested -> ... -> released | refunded`) and money handling (tinybar `bigint` / `numeric(38,0)`)
- the PASS/FAIL decision logic (`decideVerdict`), thresholds, and who can release money
- NEAR **Agent Market** (market.near.ai) is explicitly out of scope: it overlaps with this product.

NEAR AI is used only as the **inference provider** (the OpenAI-compatible LLM call) plus proof about that call.

## 1. Verified facts about NEAR AI Cloud (docs.near.ai, checked 2026-11-14)

| Fact | Source |
|---|---|
| Base URL `https://cloud-api.near.ai/v1`, header `Authorization: Bearer <sk-...>`; keys created at cloud.near.ai (credits needed) | quickstart, API intro |
| `POST /v1/chat/completions` is OpenAI-compatible; `usage`, `id` in the response | API reference |
| `GET /v1/model/list` is public. Each model has `metadata.verifiable`, `attestationSupported`, `providerType` (`vllm` = NEAR TEE, `chutes`/`tinfoil` = 3rd-party TEE, `external` = routed to OpenAI/Anthropic/Google, **not** a TEE), `supportedFeatures`, `isReady` | live call |
| `GET /v1/signature/{chat_id}?signing_algo=ecdsa` returns `{text, signature, signing_address, signature_kind?}`. A 2xx body containing `error_code` is "unavailable"; 404 may be retried briefly | response-signatures |
| `signature_kind = provider_tee` -> signed `text` is `<MODEL_ID>:<sha256(request bytes)>:<sha256(response bytes)>`. `gateway` -> `<request_hash>:<response_hash>` (binds to the gateway, not a model TEE). ECDSA = EIP-191 personal-sign recovery compared with `signing_address` | response-signatures |
| To verify `provider_tee`, send the canonical model id with header `x-no-aliasing: true`, and hash exact bytes (request `Accept-Encoding: identity`) | response-signatures |
| `GET /v1/attestation/report?model=&provider=near&signing_algo=ecdsa&nonce=<hex>` is public and non-billable; returns `gateway_attestation` and `model_attestations[]` (each has `signing_address`, `signing_algo`, `intel_quote`, `request_nonce`) | model-attestations, API reference |
| Error codes: 400, 401 bad key, 402 no credits, 429 rate limit / overloaded, 5xx | API reference |

Not verified / out of scope: full Intel TDX quote and NVIDIA GPU evidence verification. We do **not** implement it. The UI
must never claim more than what we check (see 4.3).

Default model: `z-ai/glm-5.3-flash` (`vllm`, verifiable, ready, supports `structured_outputs`, `json_mode`, `reasoning`).
Overridable with `NEAR_AI_MODEL`. Model ids in the NEAR docs are inconsistent, so the id must be one returned by
`/v1/model/list`.

## 2. Modules

| ID | Module | Where |
|---|---|---|
| M1 | LLM provider layer | `backend/src/lib/llm.ts` (replaces `nvidia.ts`), `backend/src/env.ts`; same swap in `solidity-agent`, `live-agents`, `demo-agents` |
| M2 | Verifiable inference proof | `backend/src/lib/nearProof.ts`; columns `benchmark_runs.proof`, `verifications.proof`; `routes/jobs.ts`, `routes/benchmark.ts` |
| M3 | Models used by an agent | `agents.models_used`; `routes/agents.ts`; `GET /models`; listing wizard, agent card, agent page |

### M1 LLM provider layer

Requirements
- R1.1 `askJson(system, user, schema)` keeps its exact signature, so `analyzer.ts` callers do not change.
- R1.2 Env: `LLM_PROVIDER` (`near` default | `nvidia`), `NEAR_AI_API_KEY`, `NEAR_AI_BASE_URL`
  (default `https://cloud-api.near.ai/v1`), `NEAR_AI_MODEL`. The `NVIDIA_*` variables remain, used only when
  `LLM_PROVIDER=nvidia`. No silent switching between providers: if the chosen provider has no key, throw a clear error
  (rule 4: never fake an inference).
- R1.3 NVIDIA-only request field `chat_template_kwargs` is sent only to NVIDIA.
- R1.4 Reasoning models may put text in `reasoning_content`; only `message.content` is parsed. `max_tokens` stays high
  enough (8192) for reasoning + answer.
- R1.5 Error mapping: 402 / 429 / 5xx / timeouts are infrastructure errors -> `LlmError` with a `retryable` flag. An
  infrastructure error never becomes a FAIL verdict (rule 5); the existing code path stores `ERROR` and allows retry.
  Invalid JSON after 3 attempts is also an `LlmError`, not a FAIL.
- R1.6 Same provider config in `solidity-agent` (designer analysis; it already falls back to a heuristic flagged
  `source: 'fallback'`), `live-agents` and `demo-agents` (agents' own work). These do not collect proof.

### M2 Verifiable inference proof

Applies to platform-run inference that can move money or list an agent: the **delivery verification** and the
**listing benchmark**. Only when `LLM_PROVIDER=near`.

Requirements
- R2.1 The completion request is built once, sent with `x-no-aliasing: true` and `Accept-Encoding: identity`, using raw
  `fetch` so the exact request and response bytes are available to hash.
- R2.2 After the completion, fetch `GET /v1/signature/{id}?signing_algo=ecdsa` (bounded retry, about 3 tries over 4 s),
  and `GET /v1/attestation/report?model=...&provider=near&signing_algo=ecdsa&nonce=<random 32 bytes hex>`.
- R2.3 Locally verify: (a) recovered EIP-191 signer equals `signing_address`; (b) `text` equals the expected payload
  for `signature_kind`; (c) for `provider_tee`, `signing_address`/`signing_algo` match at least one entry of
  `model_attestations[]`, and every entry that matches echoes our nonce (NEAR's report can list the same key several times).
- R2.4 Result type `LlmProof`:
  `{ provider:'near', model, chatId, signatureKind, signingAddress, signingAlgo, requestHash, responseHash, level, checkedAt, note? }`
  where `level` is `'tee_signature'` (all of R2.3 passed for `provider_tee`), `'gateway_signature'` (signature valid, but
  only binds to the gateway), `'unverified'` (signature missing, mismatched or attestation missing). The attestation
  quote itself is not verified, and the report/quote are not stored (size); we store the hashes and signer.
- R2.5 Proof collection must never change the verdict. Any proof error yields `level: 'unverified'` with a `note`; the
  verification result (PASS/FAIL/ERROR) is decided exactly as before.
- R2.6 `external` models (OpenAI/Anthropic/Google routed by NEAR) are not TEEs: proof is `unverified` with note
  "model runs outside a TEE". The verification and benchmark paths must use a `verifiable` model; the backend checks the
  model against `/v1/model/list` at first use and logs a warning if it is not verifiable.
- R2.7 Storage: new nullable `jsonb` column `proof` on `benchmark_runs` and `verifications`
  (migration `backend/drizzle-sql/0007_llm_proof.sql`). The proof is also included in the 0G report JSON. Older rows
  have `proof = null`, shown as "no proof recorded".
- R2.8 `askJson` returns the proof through an optional second-call variant, `askJsonWithProof`; `verify()` and
  `benchmark()` return it in their result object. Return shapes are otherwise unchanged.

### M3 Models used by an agent

Requirements
- R3.1 `agents.models_used text[] not null default '{}'` (same migration). It is self-declared by the lister, like
  `capabilities`.
- R3.2 `POST /agents` accepts optional `modelsUsed: string[]` (max 6, each 1-80 chars, trimmed, de-duplicated).
  New `PATCH /agents/:id/models` lets the owner update it later (owner only). Existing agents have an empty list.
- R3.3 `GET /models` (public) returns the NEAR catalog reduced to
  `{ id, name, owner, tee: boolean, ready: boolean }`, cached 10 min in memory. If NEAR is unreachable it returns
  `{ models: [], error }` with HTTP 200 and the UI falls back to free-text entry (an outage never blocks listing).
  Free-text models outside the NEAR catalog are allowed (an agent may use any model).
- R3.4 Listing wizard step 1 gets a "Models used" field: pick from the catalog, or type your own, with a hint that it
  is shown to clients. Not required.
- R3.5 Agent card shows up to 2 model chips (+N); agent detail page shows all models, with a "TEE" marker when the id
  is a verifiable NEAR model. The text clearly says "declared by the agent's owner".
- R3.6 The five seeded live agents list their model (`NEAR_AI_MODEL` default) via `roster.json`; the seed script
  updates existing rows.
- R3.7 Does not affect quotes, pricing, benchmark score or trust score.

## 3. Frontend changes

- Wizard text: "An NVIDIA model reviews..." -> "A NEAR AI model (private inference in a TEE) reviews...".
- Check list in `types.ts`: "An NVIDIA model reviews for exploitable issues" -> NEAR AI.
- Job page: verification card shows a proof badge from `latest.proof`:
  - `tee_signature`: "Verified inference · signed by a NEAR TEE key" with model, chat id, signer address (details collapsed).
  - `gateway_signature`: "Signed by the NEAR AI gateway (not bound to a model TEE)".
  - `unverified` / null: "Inference proof not available". Never a failure state.
- Benchmark report in the wizard shows the same badge.
- Types: `Agent.modelsUsed: string[]`, `LlmProof`, `Verification.proof`, `Benchmark.proof`.

## 4. Acceptance criteria

1. With `LLM_PROVIDER=nvidia` the platform behaves exactly as before.
2. With `LLM_PROVIDER=near` and a valid key, a benchmark and a verification complete and store a proof; a wrong or
   exhausted key (401/402) produces a benchmark `error` or verification `ERROR`, never a FAIL and never a listing.
3. No change to any contract, x402, A2A or job-state code. `git diff` touches none of `contracts/`, `chain/`, `x402/`,
   `routes/a2a.ts`, `stateMachine.ts`.
4. UI wording never says "verified" unless `level = tee_signature`, and describes it as a signature check, not a full
   attestation check.
5. Listing an agent with models shows them on the card and the agent page; listing without models still works.
6. Unit tests: signature payload/recovery check (valid, tampered text, wrong signer, missing model entry), `modelsUsed`
   normalisation, `LlmError` mapping. `tsc --noEmit` passes in backend and frontend.

## 5. Risks / open items

- No NEAR API key was available while writing this spec, so chat completions, the exact `signature_kind` returned for
  non-streaming calls and the reasoning behaviour of `z-ai/glm-5.3-flash` are **untested**. First task after a key is
  provided: run one real call and confirm R2.3 passes; adjust `level` logic only if the real payload differs.
- NEAR credits are required (402 if empty).
- Full TDX quote verification is deferred (future work).
