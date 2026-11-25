# SPEC-qorechain: port AgentBazaar from Hedera to QoreChain

Status: DRAFT for approval. No code is written until this is approved (see CLAUDE.md, spec-driven workflow).
Deadline: 2 Dec 2026, 23:59 UTC (QoreChain hackathon). Category: Post-Quantum AI Agents.
Baseline: commit `c75c7f7` on `main` (the NEAR AI Hackathon version of AgentBazaar).

## 1. Goal

Keep the product (agents take jobs, hire other agents, get paid from a per-job escrow only when automated
verification on NEAR AI Cloud passes) and move the money layer from Hedera testnet to QoreChain testnet
(`qorechain-diana`). Add the post-quantum story: every agent-to-agent payment carries a hybrid
secp256k1 + ML-DSA-87 signature.

Non-goals: mainnet; changing the verification or benchmark logic; new product features; SVM or CosmWasm lanes.

Decision (user, 17 Nov): the AI layer uses **NVIDIA only**. NEAR AI Cloud is removed from this port (see R10).

## 2. Confirmed facts (phase 0, run on the live testnet, 17 Nov 2026)

| Fact | Evidence |
|---|---|
| EVM chain id is 9800 (`0x2648`), RPC `https://evm-testnet.qore.host`, REST `https://api-testnet.qore.host`, Cosmos RPC `https://rpc-testnet.qore.host`, chain `qorechain-diana` | `eth_chainId`, SDK `createClient().network.endpoints` |
| `@qorechain/sdk` and `@qorechain/evm` 0.14.0 are on npm | `npm view` |
| One 20-byte identity has three encodings. `0x7CeaCe15934797DD1BA896523B213b7Bfe789BD3` is `qor10n4vu9vng7ta6xagjefrkgfm00l83x7n7r66fn` | bech32 conversion verified on a second known pair; SDK `unifiedAccountFromSeed` derives both from one secp256k1 key |
| A plain secp256k1 key (no wallet extension) can register its PQC key | tx `AD30D861E8E065AA7A0B5A28A8C646B6FA164FC257910CFD427AE6CA1573E5A2`, `MsgRegisterPQCKeyV2`, classical signature only, fee 0.08 QOR, gas 299,233 |
| The same key can then open an EVM window with a hybrid signature | tx `D7E300E51DA2E22F3407D5D65DE49D5DD100C7C4BA5500F0DB29D21C63164585`, 17,280 blocks, 20 txs, 10,000,000 uqor |
| A Foundry `cast send --create` deploy works inside the window | tx `0xeffc040efb67966027248af79c6a03604818069813737851fc3b94baf3c64901`, gas 55,330; window then showed 1/20 txs, 6,640 uqor used |
| Designer and the 5 agent accounts registered their PQC keys the same way (classical signature, code 0) | txs `6C57248E…F0B0`, `DC3C931D…BEF3`, `9468EBBB…2AA9`, `1D383735…EE6A`, `E96B5463…B892`, `8F9D97FA…969F1` |
| A hybrid-signed `MsgSend` from an agent account works; the REST receipt shows `MsgSend`, sender, recipient, amount and a `PQCHybridSignature` extension (ML-DSA-87) | tx `29CE54CEB6E3B2408B20E71407DA7B302ABCE96B3D40A23535C101BAAD528B8C`, 0.01 QOR, via `EthNativeSigner.bankSend`; receipt read from `cosmos/tx/v1beta1/txs/{hash}` |
| A larger window replaces the previous one and EVM value transfers count against `maxValue` | window re-opened with 50,000,000 uqor; six transfers (35 QOR) then succeeded |
| `TaskFactory` (compiled with `evm_version = paris`) deploys and works on chain 9800; roles read back correctly (Q4 answered for the factory, which embeds the full `TaskEscrow` creation code) | `0x83CD43960C3634bfCc63D22C971Aa2f9c8477719`, tx `0xeae17561…2540`, 10,605 bytes of runtime code |
| Full escrow cycle works on chain 9800 with the real `TaskEscrow`: createTask by the designer (gas 1,652,050), `fund` 1 QOR, `submit`, `release` with a verifier EIP-712 verdict; agent received exactly 1 QOR; final state Released | task `0x85a0dDA4180DE58d9A8d556Df9e615D4A34dFeC0`; script `backend/scripts/qore/smoke.mjs` |
| An EVM window expires by block count (about 5 hours for 17,280 blocks); a send after expiry is refused with `remaining: 0 blocks` | observed 18 Nov on the operator account; re-opened by `backend/scripts/qore/open-window.mjs`, tx `8314A094…D86A` |
| Verifier key rotated on 18 Nov (the old key was shown in a tool output); factory `setRoles` updated | tx `0x501b4d4bebe122740e8c47be91f36624dd0aa9f5ed5ef900e6eda32ce8036fe7` |
| A send that reverts on chain is charged against the window at its full gas limit x price (300,000 gas -> 33,750 uqor), not gas used; successful sends are charged gas used x price (55,330 gas -> 6,640 uqor) | window counters read before and after on 18 Nov |
| Window manager behaviour (step 2.3): a healthy window is not re-opened; `ensureWindow(..., force)` opens one with the env sizing (200 txs, 5,000,000 uqor); a real operator send consumed 1 tx | `backend/src/chain/window.ts`, live run 18 Nov |
| `eth_getLogs` refuses ranges of 10,000 blocks or more (`maximum [from, to] blocks distance: 10000`); chunked reads of 5,000 blocks decode `Funded` (1 QOR), `Submitted`, `Released` (1 QOR) for the smoke task at blocks 10,270,308 / 10,270,310 / 10,270,312 | live run 18 Nov, `backend/src/chain/logs.ts` |
| Indexer on a fresh Neon database (schema from `drizzle-kit push`, 19 tables, money columns `numeric(38,0)`): from a cursor before the smoke task, one `indexOnce()` moved the agreement `agreed` -> `released` from the on-chain events, recorded confirmed `fund` and `release` payments of 1,000,000,000,000,000,000 wei, advanced the cursor to the head; a second run changed nothing | live run 19 Nov, `backend/src/chain/indexer.ts` |
| Designer service (step 3.1) end to end: with its window expired (0 blocks left) it opened a fresh one itself, got an NVIDIA design (`source: ai`), deployed a `TaskEscrow` through the factory (price 1 QOR in wei, state Created, `factory.taskOf` matches), and a second call for the same agreement returned the existing task without a new transaction | task `0x7d384316E7dB1D966baECFc03daAa002F65f7C23`, tx `0x974d3d71…61ba`, 18 Nov live run |
| Payout report (step 3.2) end to end on testnet + the fresh database: a task was created, funded, given a sub-leg, submitted and released; the indexer moved the agreement to `released`; an old unrelated A->B payment was refused (422, underpaid), a malformed hash (400) and an unknown hash (404) were refused; agent A's real hybrid-signed 0.2 QOR transfer was verified from the REST receipt (MsgSend from A to B, 200,000 uqor, `PQCHybridSignature` algorithm 1 in `extension_options`) and recorded with `recordPayout`; reporting it again was idempotent (200); claiming the same tx for another leg was refused (409); the indexer then set the leg `paid` with `payoutTx` equal to the chain tx hash | task `0xD27a92D024937cc1dC2805a4D2B65d7224c8cF33`, payment tx `5E09B2DE…E585`, `backend/src/chain/payoutReport.ts` |
| The hybrid signature extension of a native tx appears in `body.extension_options` (critical list) in the REST receipt | receipt of tx `29CE54CE…8B8C` |
| Live agent payment (step 3.3), real backend + real Solidity Smith server on the testnet and the fresh database: a task was released with a 0.04 QOR sub-leg for Audit Hawk; the backend's `notifyPayoutsDue` reached the agent, which read what it owed from `GET /agreements/:id/payouts`, paid 0.04 QOR with a hybrid-signed native transfer and reported the tx; the backend verified it on chain and recorded it with `recordPayout`; the indexer set the leg `paid` with `payoutTx` equal to the agent's tx; sub-agent B received exactly 0.04 QOR; a repeated notice paid nothing more (ledger one entry) | task `0xE70653D486E9A34411DFBae9511b38E51c8d4aa9`, payment tx `46DBF17D…EEE0` |
| A hybrid `MsgSend` uses about 187,362 gas but the fee is charged in full at the limit set (600,000 gas at 0.2 uqor = 120,000 uqor); the agents use 300,000 gas at 0.15 uqor = 45,000 uqor | receipt of tx `5E09B2DE…E585` |
| A `MsgCrossVMCall` into the EVM lane cannot carry value: with a source VM equal to the target it is refused (`source and target VM must differ`); with another source value it is refused with `the evm lane cannot transfer funds; send them separately`. So `fund()` cannot be called with value from the native lane | txs `5BAE06E4…5C87`, `719D57DA…EABF`, 25 Nov |
| A native hybrid-signed `MsgSend` to a task contract's `qor1…` form raises the contract's EVM balance (0 -> exactly 0.1 QOR) | tx `C9C2DAA1675150174C5467C5C913868AC348D6759B625E894DE16A0357BC87F2`, test task `0x9763d98057f4e1e10F4e46CCc64fb2ad1Ff9C78b` |
| From the published package docs (not yet tried in a browser): QoreX's EVM provider only connects (no signing yet); its native provider `signAndBroadcast`s messages for a page, including `MsgSend`, and registers the PQC key itself, but refuses `MsgOpenEVMWindow`, key messages and `signArbitrary` | READMEs of `@qorechain/qorex-types` 0.1.0 and `@qorechain/wallet-adapter` 0.6.0 |
| In a real browser, QoreX `signAndBroadcast` works for a page on `http://localhost`: a self-transfer of 1 uqor with a memo and a 10,000 uqor transfer both committed with code 0, `shield: shielded`, about 6 s each; receipts show one `MsgSend`, the memo kept exactly, one signer (`cosmos.crypto.secp256k1.PubKey`, so a coin-type-118 account) and the ML-DSA-87 extension; fee 45,000 uqor at a 300,000 gas limit (about 168k used) | txs `E6001C7A…D06E` (login), `F5A45865…3AE7` (funding), 25 Nov |
| QoreX `signArbitrary` signs a text for a web page and returns a hybrid signature (`ml-dsa-87-hybrid`); `verifyMessageWithChain` from `@qorechain/qoresign` 0.1.0 with `requirePq` accepted the genuine one against the key registered on chain and refused a changed message, another account and a signature without the ML-DSA-87 part. No transaction and no fee | browser run 25 Nov, `backend/scripts/qore/qorex-test-server.mjs` |
| Gas price about 112 gwei; testnet EVM tx gas cap 30,000,000 | `eth_gasPrice`; SDK `fetchEvmLimits` |
| Opening a window advances the account's EVM nonce | SDK docs; the Foundry deploy right after succeeded |
| The PQC key needs a second secret (a `QRC1-…` recovery code) besides the classical key | SDK 0.13+ `unifiedAccountFromSeed(seed, { recoveryCode })` |
| QoreX shows only a recovery phrase, not a private key; its Send screen takes `qor1…` or `@handle`, not `0x…` | QoreX docs and UI |

Deployer account (public): `0x7CeaCe15934797DD1BA896523B213b7Bfe789BD3`. Test contract (throwaway): `0xb66Ba6F63f7D25975c44502E02f22f8C9D0ef792`.
Secrets (`QORE_DEPLOYER_PRIVATE_KEY`, `QORE_PQC_RECOVERY_CODE`) live only in git-ignored `.env` files.

Accounts (public addresses; keys and PQC recovery codes are in the git-ignored `backend/.env`):

| Role | `0x` address | Sends EVM txs |
|---|---|---|
| operator / relayer / factory owner | `0x7CeaCe15934797DD1BA896523B213b7Bfe789BD3` | yes |
| designer | `0xFAc4f7Acd048404C241d62778B61661Ba05DeAC9` | yes |
| verifier | `0xaD35905450242d327dd101A51CE0c040098B493f` | no, signs verdicts only |
| agent solidity-dev | `0x8B4F0927894Dcb933aB847a71f048d21171C73B7` | pays sub-agents |
| agent security-auditor | `0xeA953851bF7f784aeBf1EBaFc9E4A96daE7116B3` | receives |
| agent test-writer | `0x13F83608C9201F6a287e3D0bEB813683C75048D5` | pays/receives |
| agent docs-writer | `0x767F579e23f124496004dF82F3138Bfd29A18e99` | pays/receives |
| agent dapp-dev | `0xF156bfc4e048391E3ABB8A5C5C76ec19626Ced43` | pays/receives |

## 3. What replaces what

| Area | Today (Hedera) | QoreChain | Files |
|---|---|---|---|
| Chain config | chain 296, Hashio RPC, HBAR, mirror node | chain 9800, `evm-testnet.qore.host`, QOR | `backend/src/env.ts`, `chain/client.ts`, `frontend/src/lib/wagmi.ts` |
| Money unit | tinybar (1e8); viem sees weibar | wei (1e18); `msg.value` and viem agree | contracts, `frontend/src/lib/money.ts`, `escrow.ts` |
| Explorer links | HashScan | `https://explore.qore.network` | `frontend/src/lib/hashscan.ts` |
| Event indexer | mirror-node REST, cursor by consensus timestamp | viem `getLogs` on the EVM RPC, cursor by block number | `chain/indexer.ts`, `chain/mirror.ts` (delete) |
| Account/contract ids | `0.0.x` via mirror lookups | not needed (use `0x…` / `qor1…`) | `chain/ops.ts`, `agreements.task_account_id` |
| Gas | explicit limits, +600k for account auto-creation | explicit limits re-measured; no auto-creation | `chain/client.ts` |
| Agent-to-agent payment | x402 over Hedera (`@x402/hedera`, Blocky402 facilitator) | hybrid-signed native QOR transfer from the lead agent's account (see R4) | `x402/gateway.ts`, live agents |
| Client funding | MetaMask `fund()` or x402 `confirmFunding` | wallet `fund()` only | `frontend`, contracts |
| Tx admission | none | registered PQC key + open EVM window for every account that sends EVM txs | `chain/client.ts`, designer, live agents |
| AI inference (benchmark, verification, checklists, agents) | NEAR AI Cloud by default, signed responses | NVIDIA only (`LLM_PROVIDER=nvidia`), no hardware attestation | `backend/src/lib/llm.ts`, `nearProof.ts`, `nearModels.ts`, `live-agents/src/llm.ts`, `solidity-agent` |
| Verdict signing | EIP-712 secp256k1 | unchanged (domain chainId becomes 9800) | `chain/client.ts` |
| Contracts | `paris` EVM target, tinybar comments | same Solidity, wei units, renamed `payoutRef` | `contracts/` |

Unchanged: benchmark logic, Fastify routes, Postgres schema shape, designer logic, frontend structure.

## 4. Requirements

**R1 Chain config and units.** All chain parameters come from env (`QORE_EVM_RPC_URL`, `QORE_CHAIN_ID`, `QORE_REST_URL`,
`QORE_RPC_URL`, `QORE_EXPLORER_URL`). Money stays `bigint` in code and `numeric(38,0)` in SQL, now in wei (18 decimals).
Database column names containing `tinybar` are kept for this MVP to avoid a large rename; the field is documented as
"wei". No floats anywhere. UI shows QOR with up to 4 decimals.

**R2 Contracts.** Redeploy `TaskFactory` and `TaskEscrow` on chain 9800. Changes: update comments and units to wei;
rename event argument and function parameter `hederaTxId` to `payoutRef`; remove the x402-only `confirmFunding` path
(wallet `fund()` is the only funding path); keep every invariant (caps, nonce replay, EIP-712 verdicts, grace period).
Foundry target stays `paris` unless the first real deploy shows a reason to change it. Update tests; `forge test` must pass.

**R3 Window manager (backend).** Every backend account that sends EVM transactions (operator/relayer, designer) has a
registered PQC key. Before each send, `chain/client.ts` checks `fetchEvmWindow`; if the window is not live or has fewer
remaining txs or less value than the next transaction needs (gas limit x fee cap, rounded up to uqor), it opens a new
window (hybrid-signed), then re-reads the nonce and sends. Sends stay serialized per account. Windows are sized by env
(`QORE_WINDOW_BLOCKS`, `QORE_WINDOW_MAX_TXS`, `QORE_WINDOW_MAX_VALUE_UQOR`). If the account lacks funds, the job shows an
error and the operation stays queued; it never reports success (rules 3, 4).

**R4 Agent-to-agent payment.** QoreChain has no x402 scheme. After the task is Released, the lead agent A pays each
sub-agent B with a native `MsgSend` of QOR signed hybrid (secp256k1 + ML-DSA-87) by A's own account, using
`EthNativeSigner`. The backend verifies the payment on chain (tx exists, code 0, sender = A, recipient = B,
amount >= leg price, via the REST `cosmos/tx/v1beta1/txs/{hash}`) before calling `recordPayout(legId, payoutRef)`.
An unverifiable payment is never recorded. `markDefault` after the grace period is unchanged. The `/x402/*` gateway and
its dependencies are removed; the payout endpoints keep their routes under a neutral name (`/settle/...`).

**R5 Indexer.** Poll `eth_getLogs` per active task contract from a stored block cursor (`chain_cursor.last_consensus_ts`
holds the block number as a string for now). Events are stored in `chain_events` with `(tx_hash, log_index)` uniqueness,
so reprocessing is safe. Money states change only from indexed events (rule 2). Reorg handling: assume Comet BFT finality
(open question Q3); if wrong, add a confirmation depth.

**R6 Frontend.** wagmi chain 9800 and `explore.qore.network` links; "HBAR" copy becomes "QOR"; funding page checks PQC
registration and window state (`fetchPqcStatus`, `fetchEvmWindow`) and tells the user exactly what is missing; the
wallet used for the demo is QoreX (QoreX opens the window; MetaMask cannot). Rename product text only where it says HBAR,
Hedera, HashScan or x402.

**R7 Live agents and designer.** `live-agents` gets QoreChain keys (a funded, PQC-registered account each) and the
hybrid payment code from R4. The designer deploys through the factory under R3.

**R8 Docs and compliance.** `LICENSE` (MIT or Apache-2.0, user to choose), README credits the QoreChain kits and SDK,
lists the testnet addresses and contract addresses, and explains the post-quantum angle. Prompts and planning notes go
in `docs/ai-usage/`. Demo video at most 3 minutes, recorded on QoreChain.

**R10 AI layer is NVIDIA only.** `LLM_PROVIDER` defaults to `nvidia` and the NEAR code path is deleted (`nearProof.ts`,
`nearModels.ts`, NEAR env vars, NEAR copy on the landing page, README and `ProofBadge`). The verification result no longer
claims a TEE or signed-response proof, because NVIDIA's hosted API provides none. The UI says "verified by an
NVIDIA-hosted model" and shows the checks, never an attestation badge. Rule 5 still holds: an NVIDIA outage, rate limit or
bad key is an infrastructure error and never a FAIL verdict. Schema: the proof columns stay but hold `none`; a new migration
is not needed.

**R9 (stretch, not committed).** Verifier verdicts also signed with ML-DSA-87 and checked in `release()` through the PQC
Verify precompile. Only after its ABI is read from the official docs and confirmed on the testnet (Q2).

## 5. Acceptance criteria

1. Golden path on chain 9800: post job, quote, accept (contract deployed by the factory), client `fund()` from QoreX,
   agent delivers, NVIDIA-verified verdict PASS, `release()`, lead agent pays sub-agent with a hybrid-signed
   transfer, `recordPayout`, UI shows explorer links for every step.
2. Failure path: verdict FAIL leads to `refund()`; an infrastructure error (including an NVIDIA failure) never produces a FAIL (rule 5).
3. A window running out mid-job is re-opened automatically and the job still finishes.
4. `forge test` and the backend unit tests pass; no `.env` or key in git (secret scan clean).
5. A recorded payout whose chain receipt does not match is rejected.

## 6. Open questions (must be answered by testing, not assumed)

- **Q1** ANSWERED FROM DOCS 25 Nov: a page cannot open an EVM window (the user manages it inside QoreX) and cannot sign
  an EVM transaction with QoreX. Funding design needs a decision (native transfer + on-chain confirmation, or MetaMask).
  Browser test passed 25 Nov (see section 2). Decision: option 1, QoreX only (login by transaction or signature,
  funding by native transfer).
- **Q2** ABI and gas of the PQC Verify precompile (`0x…0A01`).
- **Q3** Finality and reorg behaviour of the EVM RPC.
- **Q4** ANSWERED 18 Nov: the factory and a `TaskEscrow` created through it work, including fund, submit and release.
- **Q5** PARTLY ANSWERED 18 Nov: getLogs range is limited to under 10,000 blocks (indexer chunks at 5,000). Request-rate limits are still unknown.
- **Q6** ANSWERED 17 Nov: hybrid `MsgSend` works from an agent account (see section 2). Still to build: the agent-side code in `live-agents` and the backend's receipt check.

## 7. Plan (15 days; today is 17 Nov)

| Phase | Work | Days |
|---|---|---|
| 1 | Contracts: units, rename, tests, deploy factory on 9800 (answers Q4) | 1 |
| 2 | Backend: env, viem chain, indexer, window manager, NVIDIA-only AI layer (R1, R3, R5, R10) | 3 |
| 3 | Agent payments and live agents (R4, R7) (answers Q6) | 2 |
| 4 | Frontend: chain, units, explorer, funding flow with QoreX (R6) (answers Q1) | 2 |
| 5 | End-to-end golden and failure runs on testnet | 1 |
| 6 | Licence, README, video, submission (R8); stretch R9 only if time remains | 2 |
| Buffer | | 4 |

## 8. Risks

- QoreChain docs disagree across pages on chain versions; every behaviour above is to be re-tested before relying on it.
- Backend signing keys for PQC identities (recovery codes) are secrets that must be backed up outside the repo.
- The public testnet is rate limited per IP; the indexer must poll gently and back off.

## 9. Amendment A1: QoreX-only web app (APPROVAL PENDING)

Chosen by the user on 25 Nov (option 1). It replaces R6 and the MetaMask funding path of R2, and adds R11 and R12.
Why: from a web page QoreX can sign messages and native transfers, but cannot sign EVM transactions or open EVM windows,
and a cross-VM call cannot carry value into the EVM lane (section 2).

**R2a Contract changes** (`TaskEscrow`; then redeploy `TaskFactory`, which embeds it):
- `confirmFunding()` returns: callable by anyone while `Created` and not past the deadline; requires balance >= `price`;
  sets `Funded` and emits `Funded(agreementId, client, price)`. `fund()` stays (scripts and key-holding agents).
- `release` pays the lead agent exactly `price` (today it pays the whole balance), so an overpayment never goes to the agent.
- `refundAfterDeadline` also works while `Created`: a part-paid job returns its whole balance to the client.
- New `sweepExcess()`: callable by anyone once `Released` or `Refunded`; sends any remaining balance to the client. It is
  separate from `release` so that a client address that rejects value can never block the agent's payment.
- All other invariants unchanged. Tests cover exact, partial, over and late payment, double confirm and sweep.

**R11 Sign in with QoreX (replaces wallet-nonce login with MetaMask).** The backend issues a nonce and a Sign In With
QoreChain message (`createSiwqMessage`: domain, address, uri, chain id, nonce, issued-at, 5 minute expiry). The page signs it
with `signArbitrary`. The backend verifies it with `verifySiwqWithChain`, `requirePq` on; the nonce is single use. The user
record stays keyed by the lowercase `0x` form of the same 20 bytes. An account with no registered PQC key is told to make any
first transaction in QoreX (which registers it). The optional password second factor is unchanged. Open: Q8.

**R12 Funding by native transfer.** The job page asks QoreX to send `price` in uqor to the task contract's `qor1` form
(`signAndBroadcast`, gas limit 300,000, about 0.045 QOR fee, shown to the user). The page reports the tx hash to
`POST /agreements/:id/funding`. The backend verifies on chain: success, `MsgSend` from the **client's** address to this
task, ML-DSA-87 extension; then the operator calls `confirmFunding()`. If the balance is short it answers with the missing
amount. The indexer also confirms any `agreed` task whose balance already covers the price, so a closed browser cannot
strand a paid job. Money states still change only from the indexed `Funded` event (rule 2). After `Released`/`Refunded` the
backend calls `sweepExcess()` when a balance remains. Prices are limited to 6 decimals (whole uqor).

**R6 (replaced) Frontend.** wagmi and the MetaMask connect flow are removed; a small QoreX connector uses
`window.qorex.native` (detect, enable, `getKey`, `signArbitrary`, `signAndBroadcast`) with clear states for: not installed,
too old, wrong network, rejected by the user, pending, success, error. Amounts show in QOR; "HBAR", Hedera, HashScan and x402
copy is replaced; explorer links only after Q7 is answered. The faucet link is `https://dashboard.qorechain.io/faucet`.

**Acceptance (adds to section 5; replaces "client `fund()` from QoreX" in item 1):** sign in with QoreX; fund by QoreX
transfer; partial payment shows the shortfall and can be topped up; the full job completes and the lead agent receives exactly
the price; an overpayment returns to the client.

**Open questions**
- **Q7** URL format of a transaction and an address on `explore.qore.network`.
- **Q8** Whether `verifySiwqWithChain` accepts the signature `signArbitrary` returns over a `createSiwqMessage` text
  (plain-message verification is proven; the SIWQ wrapper is not yet tried).

**Plan** (today 25 Nov): contracts, tests and redeploy 26 Nov; backend sign-in and funding 26-27; frontend 27-29; full
end-to-end 30; README and video 1 Dec; submit 2 Dec. The stretch goal R9 is dropped unless time remains.

