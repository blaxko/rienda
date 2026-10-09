# Threat model

**Scope.** Rienda limits what an AI agent can do with a budget. It assumes the **model will be fooled** (prompt injection, poisoned memory) and makes sure that being fooled has a bounded cost that the owner can see. It is hackathon-grade software: **the contract is unaudited**.

**Assets:** the USDC held per rein in the contract. **Actors:** the owner (trusted), the agent wallet (untrusted), merchants (allow-listed by the owner), anyone else (untrusted).

## 1. Tricked agent (the main case)

An agent reads a poisoned page and tries to send 500 USDC to an attacker.

- The attacker's address is not on the allowlist → **Blocked `NOT_ALLOWED`**, a strike, an event onchain. No funds move.
- Repeated attempts hit `maxStrikes` → the rein is **Frozen** in the same transaction; the next `pay` reverts.
- Demonstrated on testnet: [README transaction table](../README.md#contract-addresses--transactions) (Blocked and Blocked+Frozen).

**Residual risk:** the agent can still be tricked into paying an *allowed* merchant, within the caps. The worst case is bounded by: per-payment cap, daily cap, the rein balance, and the expiry. Anything above the per-payment cap waits for the owner, up to the hold ceiling; above the ceiling it is blocked with a strike.

## 2. Stolen agent key

Treated exactly like a tricked agent: the thief holds no USDC and can only call `pay` under the same rules. Loss is bounded as above; strikes freeze the rein; the owner can freeze immediately and withdraw. The thief can also burn the agent's MON on gas, which is the agent's own money.

## 3. Spam and griefing by the agent

- **Filling the event log:** every striking attempt counts; the rein freezes after `maxStrikes` (1–10), then `pay` reverts. The agent pays its own gas.
- **Flooding held requests:** at most 5 are open; the 6th is Blocked `TOO_MANY_HELD` with a strike. A flooded queue also blocks that agent's legitimate payments until the owner clears it: an availability cost to the owner, not a loss of funds.
- **Zero-balance probing:** `NO_FUNDS` blocks carry no strike, so an empty rein can be probed repeatedly (costing the agent gas) without freezing.

## 4. Colluding or compromised merchant

If an allow-listed merchant is malicious, or the agent is steered into paying it repeatedly, Rienda cannot tell. The loss is still capped: per payment, per UTC day, and by the rein balance, and large payments require owner approval. **Mitigation is on the owner:** list only merchants you trust, use small caps, watch the feed, remove a merchant at once if it misbehaves.

## 5. Owner-side risks

- **Stolen owner key:** the owner controls everything (withdraw, add merchants, raise limits). Rienda does not protect against this; use a hardware wallet or a dedicated owner account.
- **Wrong merchant address:** the allowlist is only as good as what the owner enters. Addresses are validated for format, not ownership.
- **Approval fatigue / social engineering:** the owner can approve a bad held request. The dashboard shows amount, merchant and memo, but the decision is theirs.

## 6. What Rienda does NOT protect

| Not covered | Why |
|---|---|
| A malicious or compromised **allowed** merchant | Allowlisting is trust; only the caps bound the loss |
| A stolen or malicious **owner** key | The owner is the root of trust |
| **Contract bugs** | Unaudited; tested with unit, fuzz and invariant tests, but not reviewed by a third party |
| **USDC issuer actions** (blacklisting, pausing, upgrades) | Funds are standard USDC; the issuer can freeze addresses including the contract |
| **Daily cap at the day boundary** | The window is a UTC calendar day, not rolling: an agent can spend up to the cap just before 00:00 UTC and again just after, so up to ~2× the daily cap in a short span (the per-payment cap and balance still apply) |
| **Approved held payments** | They do not count toward `spentToday` (the owner decided explicitly), so approvals can exceed the daily cap |
| Agent **liveness**: model errors, bad purchases, goods not delivered | Merchants are labelled addresses; nothing checks that goods arrive |
| **Prompt-injection detection** | Out of scope by design: Rienda assumes the model is fooled |
| **Per-merchant caps, categories, time-of-day rules** | Not implemented (future work) |
| **Privacy** | All payments, blocked attempts and memos are public onchain |
| Chain-level risks | reorgs of unfinalised blocks, RPC outages (reads use a fallback RPC; writes need a working RPC) |

## 7. Design choices that reduce risk

- **No revert on policy violations**, so every attempt is recorded and counted.
- **Funds stay in the contract** and move only to allow-listed merchants or back to the owner; the agent address never receives USDC (invariant-tested).
- **Per-rein accounting**: one rein can never spend another's funds (tested).
- **`ReentrancyGuard`, `SafeERC20`, checks-effects-interactions** on every token-moving function; only the configured USDC is accepted.
- **Memos are events only** (not stored), capped at 140 bytes, and rendered as plain text in the dashboard to avoid HTML injection.
- **Invalid tool arguments are rejected locally** in the agent runner and never sent.
- **Simulation before sending**: reverts such as "frozen" cost no gas.
- **Keys:** testnet demo keys are throwaway, `.env*` is git-ignored, a secret scan (gitleaks) runs before every push, and the deployer key lives in a Foundry encrypted keystore.

## 8. Verification status

| Check | Status |
|---|---|
| Unit tests (one per rule + edge cases E2–E10) | 79 passing |
| Fuzz tests | 7 passing at 10,000 runs |
| Invariants: balances sum to contract USDC; `spentToday` ≤ `dailyCap`; Frozen never pays; agent never receives USDC; open-held count consistent | 5 passing (1,000 runs × 100 calls) |
| Line coverage of `Rienda.sol` | ~99% |
| Testnet contract verified on Sourcify | exact runtime match |
| Independent audit | **none** |
