# AgentBazaar contracts (QoreChain EVM)

Solidity 0.8.24, Foundry. One contract per task covers the whole chain: client -> agent A -> sub-agent B (max 2 hops).

- `TaskFactory`: only the designer (the Solidity agent's wallet) can deploy; it enforces hard bounds on the dynamic terms.
- `TaskEscrow`: locks the client's QOR. Funding is `fund()` from a wallet (QoreX or MetaMask). After a verified PASS it
  pays A (`release`); FAIL or a missed deadline refunds the client. A -> B legs (`addSubLeg`) are paid by A with a
  hybrid-signed native QOR transfer after release; the operator records that transfer's tx hash (`recordPayout`) once the
  backend has verified it on chain, and an unpaid debt is marked defaulted after the grace period (`markDefault`).

Amounts are **wei** (1 QOR = 1e18), the unit `msg.value` uses on QoreChain's EVM lane.

Verdicts and sub-leg approvals are EIP-712 messages signed by the platform verifier key; the domain's `verifyingContract`
is the task contract, so a signature cannot be replayed on another task.

## Commands
```
forge install foundry-rs/forge-std --no-git   # first time only
forge build
forge test
```

Deploying needs the deployer account to have a registered PQC key and an open EVM authorisation window
(see `docs/SPEC-qorechain.md`, R3). Deployed addresses live in `deployments.json`.
