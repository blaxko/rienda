# Rienda

**Onchain spending limits for AI agents on Monad.** Allowed payments go through, big ones wait for the owner, rule-breaking ones are blocked and recorded onchain, and repeated rule-breaking freezes the agent.

> Let your agent spend. Keep the reins.

- **Hackathon:** Monad Metropolis · **Track:** Trust, Identity & AI Infrastructure
- **Repo:** https://github.com/blaxko/rienda · **License:** MIT
- **Demo video:** _TODO: link added before submission_
- **Status:** working on Monad **testnet** (contract verified, 4 outcomes with real transactions below). Mainnet section is a placeholder until the mainnet deploy: see [Mainnet](#mainnet-to-be-filled-after-the-mainnet-deploy).

---

## The problem

People want AI agents to pay for things: APIs, compute, data. The usual setup is a funded hot wallet or an API key that can move money, so whatever the agent is tricked into doing, the money does.

- In **May 2026** an AI-linked wallet lost roughly **$170K** after encoded instructions got an agent to generate a token transfer that its tooling executed. No contract was hacked; nothing stood between the agent and the money. ([AMBCrypto report](https://ambcrypto.com/ai-linked-wallet-drained-via-prompt-injection-in-bankr-exploit/))
- Princeton researchers found prompt-level defences give **limited protection** once an agent's memory is poisoned. ([Real AI Agents with Fake Memories, arXiv:2503.16248](https://arxiv.org/abs/2503.16248v3))

Existing fixes each break somewhere: allowances cap amounts but not where money goes; session-key systems need smart accounts and bundlers; provider policy engines can't be verified onchain. And when any of them blocks a payment, the transaction simply **reverts**, so the owner never finds out the agent was tricked.

Rienda **assumes the model will be fooled** and puts the limit outside the model, in a contract the agent cannot talk its way around.

## How it works

The owner creates a **rein** in the shared `Rienda` contract: the agent's address, a per-payment cap, a daily cap, a hold ceiling, an expiry, a strike limit, the allowed merchants, and a USDC deposit. **The funds stay in the contract.** The agent is a plain wallet that holds only MON for gas and calls `pay(reinId, to, amount, memo)`.

`pay` decides the outcome in this exact order (PRD FR-8) and **never reverts** for policy reasons:

| # | Check | Outcome | Strike |
|---|---|---|---|
| 1 | `to` is not an allowed merchant | **Blocked** `NOT_ALLOWED` | yes |
| 2 | `amount` > hold ceiling | **Blocked** `ABOVE_CEILING` | yes |
| 3 | 5 requests already waiting | **Blocked** `TOO_MANY_HELD` | yes |
| 4 | `amount` > per-payment cap, or over the daily cap | **Held** for owner approve / deny | no |
| 5 | `amount` > rein balance | **Blocked** `NO_FUNDS` | no |
| 6 | otherwise | **Paid**: USDC goes contract → merchant | no |

When strikes reach the limit the rein is **Frozen in the same transaction**; later `pay` calls revert (`ReinFrozen`). The owner can approve held payments (even while frozen), freeze/unfreeze, deposit, withdraw, and close. Only plain reverts are for caller or input errors (not the agent, frozen, expired, zero amount, memo over 140 bytes).

The contract never sends USDC to the agent or to `msg.sender` in `pay`; money only ever goes to an allow-listed merchant or back to the owner.

## Architecture

```
 [Agent runner (Node)] --pay()--> [Rienda contract on Monad] --USDC--> [Merchants]
        |  uses @rienda/sdk              |  events: Paid / Held / Blocked / Frozen / ...
        |                                v
   [LLM or script]              [Owner dashboard (Vite + React)] <-- owner wallet (MetaMask / Rabby)
```

No backend, database or hosted indexer: the contract is the source of truth and the dashboard reads events straight from the RPC. Details in [docs/architecture.md](docs/architecture.md).

## Tech stack

Solidity 0.8.28 + Foundry · OpenZeppelin Contracts 5.6.1 (`SafeERC20`, `ReentrancyGuard`) · TypeScript ~6.0 · viem 2.57 · wagmi 3.7 · @tanstack/react-query 5 · Vite 8 · React 19 · tsx · Node 22.

## How Rienda uses Monad

- **Checking every payment onchain, and logging every attack, only makes sense when fees are near zero.** A blocked attempt is a real transaction that costs the agent a fraction of a cent, so the owner gets a permanent audit trail instead of a silent revert.
- **Sub-second finality** means an agent never waits long for an answer, and the dashboard shows an attack within about a second of the block (feed polls every 1 s; the testnet run showed rows within ~3 s end to end).
- **Independent per-rein state** (no shared hot slot between reins) is designed so many agents can pay at once without contending on Monad's parallel execution. (A design property: we have not load-tested it.)
- **Plain, undelegated accounts.** Agent and owner stay normal wallets (no EIP-7702), so Monad's reserve-balance rule for delegated accounts never applies to small agent balances.
- **Monad-specific engineering we had to do:**
  - Monad charges the **declared gas limit**, not gas used (every receipt shows `gasUsed` = limit), so the SDK sends `pay` with a fixed `PAY_GAS_LIMIT` (250,000) instead of `estimateGas × N`.
  - We measured real consumption with `eth_estimateGas` at the block before each transaction: Paid ≈ 141k, Held ≈ 126k, Blocked ≈ 70k, Blocked+Frozen ≈ 71k. Local Foundry numbers understated Paid and Blocked by ~50–60% because Monad prices cold storage and account access higher.
  - The public testnet RPC limits `eth_getLogs` to **100 blocks**, so the dashboard walks history backward in adaptive chunks and stops at the rein's creation event.

## Contract addresses & transactions

### Monad testnet (chain 10143)

| What | Value |
|---|---|
| `Rienda` | [`0x70c3Bd491D1d39C29ee3D22434A5b7Ec78caaECb`](https://testnet.monadvision.com/address/0x70c3Bd491D1d39C29ee3D22434A5b7Ec78caaECb) |
| Deploy block / tx | `69462264` · [`0x281f0871…9cdf`](https://testnet.monadvision.com/tx/0x281f087167b8bb887f8ce94b740b25ec45ad9b3edd4ae775d462bda6ce9e9cdf) |
| USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Verification | Sourcify (MonadVision), exact runtime-bytecode match |

**One real transaction per outcome** (scripted injection run on rein #1):

| Outcome | What happened | Block | Transaction |
|---|---|---|---|
| **Paid** | agent pays News API $2, memo "Market news Oct 12" | 69530081 | [`0xb9371879…d385`](https://testnet.monadvision.com/tx/0xb937187918bc1f1e6fb8a9c3f10b715d077a4a96b8b3d848d16a47cf2f9ed385) |
| **Held** | $12 GPU minutes is over the $5 per-payment cap → request #2 waits for the owner | 69530089 | [`0x6496fb78…26c7`](https://testnet.monadvision.com/tx/0x6496fb78c2611a18a504a5227c3bf66e9e0b166bf8d3cdbaba4587967c5026c7) |
| **Blocked** | injected instruction: $500 to an unlisted address → `NOT_ALLOWED`, strike 1 | 69530094 | [`0xddb28113…3e5f`](https://testnet.monadvision.com/tx/0xddb2811316cd762529510b84240e45058af55b474719ee96858bd18870d33e5f) |
| **Blocked + Frozen** | third attempt → strike 3 → rein frozen automatically in the same transaction | 69530102 | [`0x871be250…c4ab8`](https://testnet.monadvision.com/tx/0x871be25068fb54b54d7df24ef25e47a582567df90f4ec80308d017191ffc4ab8) |

After the freeze the agent's next `pay` is rejected (`ReinFrozen`); that call is stopped at simulation, so it costs no gas and leaves no transaction.

### Mainnet (to be filled after the mainnet deploy)

> **TODO: not deployed yet.** Fill in after the mainnet deploy; mainnet is deployed only after the owner's explicit go-ahead.

| What | Value |
|---|---|
| `Rienda` | _TBD_ |
| Deploy block / tx | _TBD_ |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Verification | _TBD_ |
| Paid / Held / Blocked / Blocked+Frozen tx hashes | _TBD_ |
| Dashboard event latency (10 runs, p95) | _TBD_ |

## SDK quickstart (≤ 10 lines)

`@rienda/sdk` lives in this repo (`packages/sdk`); it is not published to npm.

```ts
import { createPublicClient, createWalletClient, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRienda, addresses, chainFor, transportFor } from "@rienda/sdk";

const chain = chainFor("testnet"), transport = transportFor("testnet");
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ chain, transport, account: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`) });
const rienda = createRienda({ address: addresses.testnet.rienda, publicClient, walletClient });
const r = await rienda.pay({ reinId: 1n, to: "0xMerchant…", amount: parseUnits("2", 6), memo: "News brief" });
console.log(r.outcome, r.reason, r.txHash); // "Paid" | "Held" | "Blocked", reason, tx
```

`pay` simulates first, sends with a fixed gas limit, waits for the receipt and decodes the event. Policy violations return `{ outcome: "Blocked", reason }`; only invalid calls (frozen, expired, not the agent, …) throw `RiendaRevertError`. Also: `getRein`, `getReins({ owner })`, `getRequests`, `watch`.

## Setup

Everything runs in Linux or **WSL2 Ubuntu**. Needs Node 22+ and, for the contracts, [Foundry](https://getfoundry.sh) ≥ 1.8.

### 1. Clone and install

```bash
git clone --recurse-submodules https://github.com/blaxko/rienda.git && cd rienda
git submodule update --init --recursive   # if you cloned without --recurse-submodules
npm install
npm run build -w packages/sdk             # the agent and dashboard import the built SDK
```

### 2. Contracts (optional: already deployed on testnet)

```bash
cd contracts
forge build
forge test                  # 79 unit + 7 fuzz + 5 invariant tests
forge coverage --report summary --ir-minimum   # Rienda.sol ~99% lines
```

### 3. Run the agent scenario on testnet

You need three throwaway **testnet** wallets: an **owner** (testnet MON for gas + at least 30 testnet USDC), an **agent** (a little MON, no USDC), and any **attacker** address. Get testnet MON at https://faucet.monad.xyz and testnet USDC at https://faucet.circle.com.

```bash
cast wallet new                       # run twice: owner and agent (or use any tool)
cp .env.example .env                  # then fill it in (git-ignored)
```

Fill in `.env`: `OWNER_PRIVATE_KEY`, `AGENT_PRIVATE_KEY`, `AGENT_ADDRESS` (must match the agent key), `ATTACKER_ADDRESS`. Edit `agent/merchants.json` and replace the three merchant addresses with your own wallets (the shipped ones belong to the original author). Send the agent ~1 MON for gas, then:

```bash
npx tsx scripts/create-test-rein.ts   # approves 30 USDC, creates a rein, prints the reinId
# put that id in .env as REIN_ID=<id>
npm run agent -- --mode scripted --scenario injection --network testnet
```

Expected summary: **2 Paid, 1 Held, 3 Blocked, Frozen, then 1 revert**, with an explorer link per transaction. To run again, reset the rein first (denies pending requests and unfreezes): `npx tsx scripts/reset-rein.ts`.

> **Scripted mode.** The agent actions in this scenario are **scripted** for reproducibility (a fixed list of tool calls through the same SDK); every transaction is real. An LLM tool-calling mode (`--mode llm`) is **not built yet**.

Mainnet is refused unless you pass `--confirm-mainnet`.

### 4. Owner dashboard

```bash
npm run dev -w web          # open http://localhost:5173 and connect MetaMask or Rabby
npm run build -w web        # static build in web/dist
```

Optional `web/.env` (see `web/.env.example`): `VITE_NETWORK`, `VITE_RPC_URL_TESTNET`. Anything in it is public in the browser bundle. The dashboard can create a rein itself at `/new` (approve + create), show the live feed, approve or deny held payments, freeze, deposit and withdraw.

### Environment variables

See [`.env.example`](.env.example): `RPC_URL` (optional primary RPC, e.g. Alchemy; falls back to the public RPC), `OWNER_PRIVATE_KEY`, `AGENT_ADDRESS`, `AGENT_PRIVATE_KEY`, `REIN_ID`, `ATTACKER_ADDRESS`, and `LLM_*` (reserved for the LLM mode). **Use throwaway testnet keys only.** `.env*` is git-ignored; run `gitleaks detect --source .` before pushing.

## Threat model & limits

Rienda bounds the **worst case**; it does not stop an agent from being fooled. Full analysis in [docs/threat-model.md](docs/threat-model.md). In short:

- **Tricked agent:** it can only pay allow-listed merchants, within the caps; anything else is blocked, recorded, and freezes the rein after the strike limit.
- **Stolen agent key:** treated exactly like a tricked agent; the key holds no USDC.
- **What it does NOT protect:** a malicious or compromised **allowed** merchant (loss is bounded by the caps), a stolen **owner** key, bugs in the (unaudited) contract, and USDC issuer actions. The daily cap is a UTC calendar day, so up to ~2× the daily cap can move across midnight.

## Differences from AgentLeash / MetaMask permissions

As we understand those approaches (from our own research notes; see [docs/PRD.md](docs/PRD.md) §8.8, §14):

- **Plain contract + any wallet.** No smart accounts, session keys, bundlers or a specific wallet (MetaMask's permissions flow needs Flask today).
- **Recipient allowlist.** Allowance-style caps limit amounts but let the spender send money anywhere.
- **Blocked attempts are recorded onchain** instead of reverting, so the owner sees what the agent was tricked into trying.
- **Auto-freeze** after repeated rule-breaking, and **hold-for-approval** for large payments instead of a flat refusal.
- Built and demonstrated on **Monad** (testnet now, mainnet pending).

## Pre-existing code

**None.** All project code was written for this hackathon, in this repository, starting Oct 9, 2026. Third-party libraries are used as dependencies only (see Attribution). No code was copied from AgentLeash or other projects.

## AI tools used

**Claude Code (Anthropic)** was used throughout the build, working in the terminal on this repository under the owner's direction. It wrote the `Rienda.sol` contract and its unit, fuzz and invariant tests; the TypeScript SDK; the agent runner, tools and scenarios; the Vite/React dashboard; and these docs. The human owner set the scope and requirements ([docs/PRD.md](docs/PRD.md)), made every decision about keys, deploys and spending, ran the deploy and browser tests, and reviewed the results. The commit history shows the work day by day. The agent's behaviour in the demo is **scripted**; no LLM is used by the agent yet.

## Attribution

[OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) (MIT) · [forge-std](https://github.com/foundry-rs/forge-std) · [Foundry](https://getfoundry.sh) · [viem](https://viem.sh) · [wagmi](https://wagmi.sh) · [TanStack Query](https://tanstack.com/query) · [Vite](https://vite.dev) · [React](https://react.dev) · [tsx](https://tsx.is) · [TypeScript](https://www.typescriptlang.org). The `openai` client is planned for the LLM mode and is not used yet.

## License

[MIT](LICENSE)
