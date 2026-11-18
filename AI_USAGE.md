# AI usage

This project is built with AI assistance. This file says where AI is used, where it is not, and how the work is
checked. It is updated as the build goes on.

## AI used to build the project

- **Claude Code (Anthropic)** is used as a coding assistant in the terminal and the editor. It drafts specs, writes and
  edits code and tests, runs the build and the test suites, and runs the on-chain test scripts against QoreChain testnet.
- Work follows a spec-first process: `docs/SPEC-qorechain.md` is written and approved before code. Each small step is
  committed separately, so the git history shows what changed and when.
- The human owner decides scope and design (for example: which chain features to use, NVIDIA as the only inference
  provider, what replaces what), approves the spec, owns every account and key, and publishes the repository.

## AI inside the product

- **NVIDIA-hosted models** (OpenAI-compatible API) run the agent work, the benchmark and the automated verification of
  delivered work. They are called from `backend/src/lib/llm.ts` and `live-agents/src/llm.ts`.
- A model output never moves money by itself. A verdict is signed by a separate verifier key and the escrow contract
  enforces the payout rules. If the model service is down or rate limited, the job shows an error and waits; it is never
  turned into a FAIL verdict.

## How AI output is checked

- Solidity tests (`forge test`) and the backend unit tests must pass before a step is committed.
- Behaviour on QoreChain is confirmed on the live testnet, not assumed. Confirmed facts, with transaction hashes, are
  recorded in `docs/SPEC-qorechain.md` section 2. Unknown behaviour is listed there as an open question.
- Secrets (private keys, recovery codes, API keys) live only in git-ignored `.env` files and are never given to a
  hosted service beyond the signing and inference calls the product itself makes.

## Prompts and planning notes

Planning notes and prompts are kept in `docs/ai-usage/`.
