# Architecture

Rienda is one shared contract, a small TypeScript SDK, an agent runner and an owner dashboard. There is no backend, database or hosted indexer: the contract is the source of truth and everything else reads or writes it through an RPC.

## Components

```
                         +---------------------------+
   owner wallet -------> |   Owner dashboard (web)   |  Vite + React + wagmi
   (MetaMask/Rabby)      |   create rein, feed,      |  reads logs by polling the RPC
                         |   approve/deny, freeze    |
                         +-------------+-------------+
                                       | owner txs (create, approve, freeze, withdraw...)
                                       v
 +-----------------+  pay()   +-------------------------+  USDC transfer   +-----------+
 | Agent runner    | -------> |   Rienda contract       | ---------------> | Merchants |
 | (Node, scripted)|          |   (Monad)               |  only allow-     +-----------+
 |  @rienda/sdk    | <------- |   reins, caps, strikes, |  listed addresses
 +--------+--------+  events  |   held requests, USDC   |
          |                   +-------------+-----------+
          |                                 | events: Paid / Held / Blocked / Frozen / Approved ...
   (LLM mode planned;                       v
    scripted today)                 audit trail on the explorer (MonadVision)
```

| Part | Where | Role |
|---|---|---|
| Contract | `contracts/src/Rienda.sol` | Holds USDC per rein, decides every payment, records every outcome as an event |
| SDK | `packages/sdk` | ABI, addresses, chains (+ RPC failover), `createRienda`: `pay`, `getRein`, `getReins`, `getRequests`, `watch`; the only place the ABI, addresses and gas constant live |
| Agent | `agent/` | CLI runner; tools `list_merchants`, `check_budget`, `read_page`, `pay`; scripted scenarios `normal` and `injection` |
| Dashboard | `web/` | Owner UI; reads history and live events with `getLogs`, no indexer |
| Scripts | `scripts/` | `create-test-rein.ts`, `reset-rein.ts` (owner-side testnet helpers) |

## Data model (onchain)

```solidity
enum Status    { None, Active, Frozen, Closed }
enum Outcome   { Paid, Held, Blocked }
enum Reason    { None, NOT_ALLOWED, ABOVE_CEILING, TOO_MANY_HELD, NO_FUNDS }
enum ReqStatus { None, Pending, Approved, Denied }

struct Rein {            // one per agent; money is accounted per rein
  address owner; address agent;
  uint128 balance, perPayCap, dailyCap, holdCeiling, spentToday;
  uint64  day, expiry;   // day = block.timestamp / 1 days (UTC calendar day)
  uint8   strikes, maxStrikes, openHeld;
  Status  status;
}
struct Request { uint256 reinId; address to; uint128 amount; uint64 createdAt; ReqStatus status; }
```

Storage is `reins`, `isMerchant[reinId][address]` and `requests`, plus the immutable `usdc`. **Memos are never stored**: they live only in events.

## The `pay` decision (never reverts for policy reasons)

```
pay(reinId, to, amount, memo)
 |- revert only if: unknown rein, caller != agent, Frozen/Closed, expired, amount == 0, memo > 140 bytes
 |- roll the day window if block.timestamp / 1 days changed (spentToday = 0)
 |- to not allowed .............. Blocked NOT_ALLOWED       + strike
 |- amount > holdCeiling ........ Blocked ABOVE_CEILING     + strike
 |- openHeld >= 5 ............... Blocked TOO_MANY_HELD     + strike
 |- amount > perPayCap or spentToday + amount > dailyCap
 |                                 Held  (Request created, openHeld++)
 |- amount > balance ............ Blocked NO_FUNDS          (no strike)
 `- else ....................... Paid: balance -= amount, spentToday += amount, USDC -> merchant
 after any strike: if strikes >= maxStrikes -> status = Frozen, emit Frozen(reinId, auto = true)
```

Why blocks emit instead of reverting: events in a reverted transaction are discarded, so a revert leaves no trace and cannot count strikes. Returning lets the contract keep the audit trail and freeze the rein in the same transaction.

Safety properties enforced in code and tests: `ReentrancyGuard` and `SafeERC20` on everything that moves tokens, effects before interactions, USDC only to allow-listed merchants (or back to the owner), `approve` pays even while Frozen but never counts toward `spentToday`, and the agent address never receives USDC.

## Events and the dashboard feed

Events: `ReinCreated`, `MerchantSet`, `LimitsSet`, `Deposited`, `Withdrawn`, `Paid`, `Held`, `Blocked`, `Frozen`, `Unfrozen`, `Approved`, `Denied`, `Closed`. `Approved` and `Denied` carry only a `requestId`, so the feed joins them to the earlier `Held` event to show amount, merchant and memo.

`web/src/lib/events.ts`:

1. **History**: read the chain head, then walk **backward** in `getLogs` chunks (start 5,000 blocks, halve on error; the public testnet RPC allows only 100), several chunks in parallel, stopping as soon as the rein's `ReinCreated` is found. Cost follows the rein's age, not the contract's.
2. **Live**: poll `getBlockNumber` every 1 s and fetch `getLogs` for new blocks.
3. **Pending requests** are read from the contract (`getRequests`, multicall) rather than derived from events, so they are authoritative.
4. User text (memos, merchant labels) is rendered as plain text nodes, never as HTML.

## Gas and Monad specifics

- Monad charges the **declared gas limit**, so the SDK sends `pay` with a fixed `PAY_GAS_LIMIT` (250,000), set from `eth_estimateGas` measured on Monad testnet (Paid ≈ 141k, Held ≈ 126k, Blocked ≈ 70k, Blocked+Frozen ≈ 71k) plus margin. Receipts report `gasUsed` equal to the limit, so they cannot be used to measure.
- The agent keeps a MON balance for gas; the dashboard warns when it covers fewer than 20 calls.
- Reads use a fallback transport: an optional primary RPC (e.g. Alchemy) then the public Monad RPC. Multicall3 is used for batched reads.

## Failure modes handled

| Case | Behaviour |
|---|---|
| Frozen / expired / not the agent | `pay` reverts at simulation: no gas, no strike |
| Agent out of MON | transaction cannot be sent; runner and dashboard warn |
| Owner on the wrong network | dashboard shows "Switch to Monad" (adds the network if missing) and blocks actions |
| Approve with balance below the request | reverts; request stays Pending; dashboard disables Approve |
| Merchant removed while a request is Pending | owner can still approve or deny it |
| Rein expires with Pending requests | `pay` reverts; owner can still approve, deny, withdraw |
| RPC log-range limit | adaptive chunking from the chain head backward |
| Malformed tool arguments | validated locally; invalid calls are rejected and never sent |
