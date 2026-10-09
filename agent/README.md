# agent

CLI agent runner. **Scripted** mode only: a fixed list of tool calls replayed through the same SDK, sending real transactions. Scenarios: `normal` and the prompt-injection `injection` scenario. No AI model is involved.

```bash
npm run agent -- --scenario injection --network testnet   # --mode scripted is the default
```
