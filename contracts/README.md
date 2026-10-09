# contracts

Foundry project for the shared `Rienda` contract (Solidity, tests, deploy scripts).

## Setup

Libraries (`forge-std` v1.17.0, `openzeppelin-contracts` v5.6.1) are git submodules under `lib/`. After cloning, from the repo root:

```bash
git submodule update --init --recursive
cd contracts && forge build && forge test
```
