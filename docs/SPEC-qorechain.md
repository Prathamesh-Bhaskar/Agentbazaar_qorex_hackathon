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
| verifier | `0xbF4EbcBB325E4d0e8D0Bc44D3faF8CC70c9610fC` | no, signs verdicts only |
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

- **Q1** How does a web-app user open an EVM window from the browser with QoreX? The docs say QoreX does it; the exact
  dApp-side call (wallet-adapter `openEvmWindowMsg`) is untested.
- **Q2** ABI and gas of the PQC Verify precompile (`0x…0A01`).
- **Q3** Finality and reorg behaviour of the EVM RPC.
- **Q4** Whether Foundry's `paris` output deploys the real `TaskEscrow` (only a 10-byte contract is tested so far).
- **Q5** Rate limits on the public RPC and REST endpoints for the indexer.
- **Q6** Whether `EthNativeSigner` hybrid signing of `MsgSend` works for an agent process end to end (the window message did).

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
