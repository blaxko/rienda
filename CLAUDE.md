# CLAUDE.md — Rienda

**Rienda: onchain spending limits for AI agents on Monad — allowed payments go through, big ones wait for the owner, rule-breaking ones are blocked, recorded onchain, and freeze the agent.**

Source of truth for scope: `docs/PRD.md`. If this file and the PRD disagree, the PRD wins; fix this file.

---

## 1. What we're building and why it qualifies

- **Hackathon:** Monad Metropolis. **Deadline: Oct 13, 2026, 11:59 PM ET = Oct 14, 04:59 WAT.** Internal deadline: **Oct 13, 18:00 WAT.**
- **Primary track:** Trust, Identity & AI Infrastructure — Rienda is a shared contract + SDK other agent builders use, not a standalone consumer app.
- **Bounties (only if their stretch item ships):** Qwen 3.8 Max (agent model, Trust track, credits) · KIMI (credits) · Envio (S2) · Alchemy (if RPC counts as meaningful).
- **Judging:** Product 20 · Technical 20 · Monad integration 20 · Track fit 20 · Innovation 20.

**How it works:**
1. Owner creates a **rein** in the `Rienda` contract: agent address, per-payment cap, daily cap, hold ceiling, expiry, max strikes, allowed merchants, USDC deposit. Funds stay in the contract.
2. The agent (a plain wallet holding only MON for gas) calls `pay(reinId, to, amount, memo)`.
3. Outcome, checked in this exact order (PRD FR-8), never reverts:
   1. `to` not allowed → **Blocked** `NOT_ALLOWED` + strike
   2. `amount > holdCeiling` → **Blocked** `ABOVE_CEILING` + strike
   3. open held ≥ 5 → **Blocked** `TOO_MANY_HELD` + strike
   4. `amount > perPayCap` or over daily cap → **Held** for owner approve/deny
   5. `amount > balance` → **Blocked** `NO_FUNDS` (no strike)
   6. else → **Paid**, USDC goes contract → merchant
4. Strikes ≥ `maxStrikes` → **Frozen** in the same tx; later `pay` calls revert.
5. Dashboard shows every event live; owner approves, freezes, withdraws.

**Differs from AgentLeash/MetaMask permissions:** plain contract + any wallet, recipient allowlist, blocked attempts recorded onchain, auto-freeze, hold-for-approval, Monad mainnet. Say this in README and video.

---

## 2. Tech stack (versions checked on npm, Oct 8, 2026)

| Area | Tool / package | Version |
|---|---|---|
| Environment | Windows + **WSL2 Ubuntu** for all CLI work | — |
| Runtime | Node.js | 22 LTS or 24 |
| Contracts | Foundry | **≥ 1.8.0** |
| | Solidity | pin one 0.8.x version in `foundry.toml` |
| | OpenZeppelin Contracts | 5.6.1 (`SafeERC20`, `ReentrancyGuard`) |
| SDK / agent / web | TypeScript | **~6.0** (not 7.x) |
| | viem | 2.57.x |
| Agent | tsx | 4.23.x |
| | openai (OpenAI-compatible client) | 7.30.x |
| Dashboard | vite | 8.3.x |
| | react / react-dom | 19.x |
| | wagmi | 3.7.x |
| | @tanstack/react-query | 5.x |
| Chain | Monad mainnet | chain 143, `https://rpc.monad.xyz` |
| | Monad testnet | chain 10143, `https://testnet-rpc.monad.xyz` |
| Token | USDC mainnet | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| | USDC testnet | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| RPC | Alchemy Monad (primary) + public RPC (fallback) | — |
| Explorer verify | MonadVision (Sourcify) | `https://sourcify-api-monad.blockvision.org/` |
| Hosting | Vercel or Railway (static dashboard) | — |

Read USDC `decimals()` at runtime (expect 6).

---

## 3. Repo structure

```
rienda/
├── CLAUDE.md                   this file
├── README.md                   judge-facing: problem, demo, architecture, Monad usage, addresses + tx hashes, setup, AI disclosure
├── LICENSE                     MIT
├── package.json                npm workspaces: packages/*, agent, web
├── docs/
│   ├── PRD.md                  requirements (source of truth)
│   ├── architecture.md         diagram + data flow
│   └── threat-model.md         tricked agent, stolen agent key, spam, limits of the design
├── contracts/                  Foundry project
│   ├── src/Rienda.sol          the shared contract
│   ├── src/mocks/MockUSDC.sol  tests only (6 decimals)
│   ├── test/Rienda.t.sol       unit tests, one per rule + edge case
│   ├── test/RiendaFuzz.t.sol   fuzz on amounts/caps/timestamps
│   ├── test/Invariant.t.sol    balances sum, daily cap, frozen never pays
│   ├── script/                 deploy helpers
│   └── foundry.toml
├── packages/sdk/               @rienda/sdk — used by agent and web
│   ├── src/index.ts            createRienda(): pay, getRein, getRequests, watch
│   ├── src/abi.ts              ABI (generated from forge out/)
│   ├── src/addresses.ts        per-chain contract + USDC + deploy block
│   └── src/chains.ts           Monad chains + RPC failover
├── agent/                      CLI agent runner
│   ├── src/run.ts              arg parsing, mode switch
│   ├── src/tools.ts            list_merchants, check_budget, read_page, pay
│   ├── src/llm.ts              OpenAI-compatible tool-calling loop, temperature 0
│   ├── src/scripted.ts         fixed tool-call sequences
│   ├── scenarios/normal.ts, injection.ts
│   ├── fixtures/pages/         local "web pages"; injected page lives here
│   └── .env.example            RPC_URL, AGENT_PRIVATE_KEY, REIN_ID, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
└── web/                        owner dashboard (Vite + React + wagmi)
    ├── src/pages/Reins.tsx     list owner's reins
    ├── src/pages/NewRein.tsx   create form with defaults
    ├── src/pages/Rein.tsx      balance, spend meter, strikes, merchants, feed, held panel, freeze
    └── src/lib/events.ts       chunked getLogs + 1 s polling
```

---

## 4. Build phases

Each phase ends with its exit test passing. No stretch work while any Must box is open.

1. [ ] **Phase 0 (tonight)** — accounts, keys, WSL, tools, funded wallets (see `PHASE_0_CHECKLIST.md`).
2. [ ] **Day 1 (Fri Oct 9) — Contract**
   - [x] `Rienda.sol`: create, deposit, withdraw, setMerchant, setLimits, pay (FR-8 order), approve, deny, freeze, unfreeze, close
   - [x] Unit tests for every rule and edge case E2–E10; fuzz; invariants; coverage ≥ 95%
   - [x] `forge snapshot` → set `PAY_GAS_LIMIT` = measured + 20% → **300,000 (provisional)**; local measure was 123,519 max. To be re-measured on Monad testnet receipts after deploy (see `docs/PRD.md` §5 Risk parameters)
   - [x] Deploy + verify on testnet → `0x70c3Bd491D1d39C29ee3D22434A5b7Ec78caaECb`, block 69462264 (exact-match verified on Sourcify)
3. [ ] **Day 2 (Sat Oct 10) — SDK + agent**
   - [ ] SDK `pay` (simulate → send with fixed gas → decode outcome), `getRein`, `watch`
   - [ ] Agent scripted mode + injection scenario → exit: 2 Paid, 1 Held, 3 Blocked, Frozen, then revert, on testnet
   - [ ] Agent LLM mode, normal scenario
4. [ ] **Day 3 (Sun Oct 11) — Dashboard**
   - [ ] Connect wallet, create rein (approve + create ≤ 3 tx), rein page, live feed, held approvals, freeze/unfreeze, low-gas warning
   - [ ] Exit: flows F1–F5 in the browser on testnet
5. [ ] **Day 4 (Mon Oct 12) — Mainnet + proof**
   - [ ] Deploy + verify on mainnet with small USDC
   - [ ] Run injection scenario on mainnet; record one tx hash per outcome in README
   - [ ] 10-run timing: blocked event → dashboard ≤ 3 s p95
   - [ ] README complete; S1 (Qwen/KIMI model) only if all above done
6. [ ] **Day 5 (Tue Oct 13) — Video + submit** by 18:00 WAT. No new features.

**Stretch (in order):** S1 Qwen/KIMI agent model → S2 Envio feed → S3 multi-agent dashboard → S4 browser notifications.

---

## 5. Commands

All commands run in **WSL2 Ubuntu** unless marked.

### Setup
```bash
# Windows PowerShell (admin), once:
wsl --install -d Ubuntu

# inside WSL:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && source ~/.bashrc
nvm install 22 && nvm alias default 22
curl -L https://foundry.paradigm.xyz | bash && source ~/.bashrc && foundryup
forge --version          # >= 1.8.0
gh auth login
gh repo clone blaxko/rienda && cd rienda
npm install              # workspaces
```

### Contracts (from `contracts/`)
```bash
forge init --no-git --force .                         # first time only
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1
forge build
forge test -vvv
forge test --match-contract Invariant -vvv
forge test --fuzz-runs 10000
forge coverage --report summary
forge snapshot                                        # pay() gas -> PAY_GAS_LIMIT

cast wallet import rienda-deployer --interactive      # key never in .env
cast wallet address --account rienda-deployer

# testnet
forge create src/Rienda.sol:Rienda --rpc-url https://testnet-rpc.monad.xyz \
  --account rienda-deployer --broadcast \
  --constructor-args 0x534b2f3A21130d7a60830c2Df862319e593943A3

# mainnet (ask the human first)
forge create src/Rienda.sol:Rienda --rpc-url https://rpc.monad.xyz \
  --account rienda-deployer --broadcast \
  --constructor-args 0x754704Bc059F8C67012fEd69BC8A327a5aafb603

# verify (use --chain 10143 for testnet)
forge verify-contract <ADDR> src/Rienda.sol:Rienda --chain 143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/

# export ABI to the SDK
jq '.abi' out/Rienda.sol/Rienda.json > ../packages/sdk/src/Rienda.abi.json
```

### Inspect / fund
```bash
cast call <RIENDA> "getRein(uint256)" <REIN_ID> --rpc-url $RPC
cast call <USDC> "balanceOf(address)(uint256)" <ADDR> --rpc-url $RPC
cast balance <AGENT_ADDR> --rpc-url $RPC                       # agent MON for gas
cast send <AGENT_ADDR> --value 1ether --account rienda-deployer --rpc-url $RPC   # fund agent gas (1 MON)
cast logs --address <RIENDA> --from-block <DEPLOY_BLOCK> --rpc-url $RPC
cast wallet new                                                # create a fresh agent key
```
Testnet MON: `https://faucet.monad.xyz` (backups: Alchemy, QuickNode faucets).

### SDK / agent / web (from repo root)
```bash
npm run build -w packages/sdk
npm run agent -- --mode scripted --scenario injection --network testnet
npm run agent -- --mode llm --scenario normal --network testnet
npm run dev -w web            # open http://localhost:5173 in Windows browser
npm run build -w web && npm run preview -w web
```

### Hygiene
```bash
gitleaks detect --source .         # before every push (binary in ~/.local/bin; config: .gitleaks.toml)
git log --oneline | head           # daily commits (judges check history)
```

---

## 6. Demo plan (what the judge sees, in order — ≤ 3:00, captions on)

1. **0:00–0:20** — Problem card: "May 2026: an AI agent was tricked into sending ~$170K. Nothing stood between the agent and the money."
2. **0:20–0:45** — Dashboard: create a rein — $5 per payment, $20/day, hold ceiling $50, 3 strikes, merchants News API / GPU minutes / Coffee, deposit $30.
3. **0:45–1:05** — Terminal + dashboard side by side: agent buys news ($2) and GPU minutes ($4) → **Paid** rows appear; spend meter 6/20.
4. **1:05–1:25** — Agent tries $12 GPU → **Held** → owner clicks Approve → Paid.
5. **1:25–2:10** — **The moment:** agent reads a poisoned page → tries 500 USDC to 0xATTACKER → **Blocked** (red) ×3 → **FROZEN** banner → next call reverts. Balance unchanged.
6. **2:10–2:25** — MonadVision: the blocked attempts as real onchain events.
7. **2:25–2:45** — Why Monad + the 10-line SDK snippet.
8. **2:45–3:00** — Repo URL, contract address, "agent actions scripted for reproducibility" if scripted mode was used.

---

## 7. 60-second pitch (~150 words)

> In May, an AI agent was talked into sending about a hundred and seventy thousand dollars to a stranger. No contract was hacked. The agent simply had the keys, and nothing stood between it and the money.
>
> Rienda is that missing layer. You put your agent on a rein: it can pay only the merchants you allow, up to the limits you set. Anything bigger waits for your one-click approval. Anything that breaks the rules is blocked — and recorded onchain, so you see exactly what your agent was tricked into trying. Three strikes and the agent freezes itself.
>
> It's one shared contract on Monad and a tiny SDK, so any agent can use it with any wallet. Monad's near-zero fees make it practical to check every payment and log every attack, and sub-second finality means agents never wait.
>
> Let your agent spend. Keep the reins.

---

## 8. Known errors and bad patterns

| Symptom / trap | Cause | Do this |
|---|---|---|
| `foundryup` or scripts fail in PowerShell | Foundry installer needs bash | Use WSL2 Ubuntu for all CLI work |
| Dashboard in Windows browser can't reach dev server | Server bound to WSL only | Vite usually forwards `localhost`; else `npm run dev -- --host` and use the WSL IP |
| `Stack too deep` compiling `createRein` | Too many arguments | Pass a `ReinParams` struct |
| Blocked attempts don't show in the feed | `pay` reverted instead of returning Blocked; events in reverted txs are discarded | Only FR-7 cases revert; FR-8 outcomes must return |
| Daily cap tests flaky | Rolling window logic | Calendar day: `day = block.timestamp / 1 days`; test with `vm.warp` at 23:59:59 / 00:00:00 |
| Agent tx stuck / "nonce too low" | Sending the next `pay` before the last receipt | `await` each receipt before the next call |
| Agent tx fails with out-of-funds | **Monad charges the declared gas limit, not gas used** | Fixed `PAY_GAS_LIMIT` from snapshot + 20%; keep ≥ 1 MON on the agent |
| Amounts off by 10¹² | Assumed 18 decimals | USDC = 6; read `decimals()` |
| `getLogs` errors | RPC block-range limit | Chunk from deploy block; failover RPC |
| Old testnet addresses missing | Testnet reset Dec 2025 | Use only this week's deployments |
| TS build errors after install | TypeScript 7.x pulled in | Pin `typescript@~6.0` |
| wagmi can't find Monad | Chain not configured | Use viem's Monad chain defs (or define 143 / 10143 manually in `packages/sdk/src/chains.ts`) |
| LLM ignores the injected instruction | Model behaviour varies | Temperature 0, fixed page; else scripted mode (disclosed) |
| LLM sends bad tool args | Malformed JSON | Validate before sending; never send unvalidated calls |
| Memo renders as HTML | XSS via memo | Render as plain text only |

**Bad patterns:**
- Sending USDC to the agent or `msg.sender` anywhere in the contract.
- Reverting on policy violations (kills the audit trail and auto-freeze).
- Storing memos in contract storage (event only).
- `estimateGas() * 2` as the gas limit (you pay the whole limit on Monad).
- Building the dashboard before the contract's tests pass.
- One giant commit at the end.

---

## 9. Things NOT to do

- No backend, database or hosted indexer (Envio is S2 only).
- No smart accounts, session keys, ERC-7715, EIP-7702, paymasters or bundlers.
- No tokens other than USDC; no price oracles.
- No prompt-injection detector in the model — Rienda assumes the model is fooled.
- Never commit private keys, `.env`, RPC or LLM API keys.
- Never deploy to mainnet or send a mainnet transaction without asking the human first.
- Never fake or hand-edit transactions in the demo; if the agent is scripted, say so.
- Never copy code from AgentLeash or other projects; attribute every library used.
- Don't change the `pay` outcome order, the event signatures or the ABI after Day 2 without updating the SDK, web and README together.
- Don't use Monad or Metropolis logos beyond naming the event.
- Don't start stretch work while any Must box is open.

---

## 10. Working rules for Claude Code

- Before building a feature, re-read its FR-/acceptance criteria in `docs/PRD.md`.
- `forge test` must pass before every commit touching `contracts/`.
- ABI, addresses, chains and gas constants live only in `packages/sdk`; agent and web import them.
- After any deploy, update `packages/sdk/src/addresses.ts` and the README addresses table in the same commit.
- Small, frequent commits with clear messages; AI-tool use disclosed in README.
- At the end of each session: tick finished boxes in §4 and add new errors to §8.
