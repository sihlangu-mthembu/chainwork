# Runbook: Chainwork on Aevum (Windows PowerShell)

These steps run on the human's machine, because it is the only one that can reach the Aevum RPC.
Keys live only in `.keys\` as encrypted keystores (git ignores that folder). The password is asked
once and kept only in the PowerShell process.

## 1. Put funds on the deployer
The deployer `0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1` needs about **0.5 tQDAY** (gas for
deploying and for seven role wallets at 0.05 each) and **at least 0.8 tUSD8**. Easiest: in the QDay
Discord, run `/faucet` with the deployer's address (1 tQDAY + 5 tUSD8 a day).

## 2. One command
```powershell
cd C:\dev\chainwork
git pull
pnpm install
.\scripts\aevum.ps1
```
It checks tools and balances, deploys (`deployments\aevum.json`), proves every contract's bytecode,
splits the funds (the coordinator gets gas only), runs Gate 1, then plays S0–S5 live on Aevum
(about 15 minutes). Steps already done are skipped. Run one step with `-Step check|deploy|verify|fund|gate1|demo|status`.

If PowerShell refuses to run scripts: `Set-ExecutionPolicy -Scope Process Bypass` first (this window only).

## 3. Send the results back
```powershell
git add deployments/aevum.json aevum-run.log
git commit -m "deploy: Aevum testnet"
git push
```
If `git push` asks for a login, skip it and tell Claude: the two files can be picked up from the folder.

## Wallets
| Role | Keystore | Address |
|---|---|---|
| deployer / relayer | `.keys/deployer` | `0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1` |
| client | `.keys/client` | `0xbE213deEEf489afDf67842F411472Aa90f8f8D77` |
| coordinator (0 tUSD8) | `.keys/coordinator` | `0x28C0B52FAd3Ce860324C3DA7DfDdcD7b94cEA40A` |
| specialist-data | `.keys/specialist_data` | `0xa5130D2A006d13750Fbc2E7b66cad6Cb9ad9B5c3` |
| specialist-bad | `.keys/specialist_bad` | `0x80Dec5f266418EB8ae26A6C2Ee592c9082E4c00d` |
| backup | `.keys/backup` | `0x7117c6741d15f794751C447Df5F96F48501D1DA9` |
| watcher | `.keys/watcher` | `0xFCEB78c36c369d0C90a6c91d4498A1991Ed036bd` |
| evaluator | `.keys/evaluator` | `0x6024AaEC247E11c53c9799ED018D67Ee2B5373e4` |

Agents and services load these with `loadKeystoreAccount` from `@chainwork/sdk/node`.
