# Runbook: deploy and Gate 1 on Aevum (Windows PowerShell)

These steps run on the human's machine, because it is the only one that can reach the Aevum RPC.
Keys live only in `.keys\` as encrypted keystores (git ignores that folder). The password is never written to disk: you type it into the session.

## 0. Once per session
```powershell
cd C:\dev\chainwork
git pull
pnpm install
$env:CHAINWORK_KEYSTORE_PASSWORD = Read-Host "Keystore password"
```

## 1. Check the deployer has funds
```powershell
cast balance 0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1 --rpc-url https://rpc-test.qday.info --ether
cast call 0x456569838f1d43009A91ebA4263147Afd7233483 "balanceOf(address)(uint256)" 0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1 --rpc-url https://rpc-test.qday.info
```
Needs about 1 tQDAY and at least 1 tUSD8 (1000000).

## 2. Deploy the contracts (once)
```powershell
$env:ACCOUNT_OWNER = "0xbE213deEEf489afDf67842F411472Aa90f8f8D77"   # client wallet owns the client AgentAccount
forge script contracts/script/Deploy.s.sol:DeployAevum --rpc-url https://rpc-test.qday.info --broadcast --legacy `
  --keystore .keys/deployer --password $env:CHAINWORK_KEYSTORE_PASSWORD
```
Writes `deployments\aevum.json`.

## 3. Prove the deployed bytecode is this source
```powershell
python scripts/verify_bytecode.py deployments/aevum.json https://rpc-test.qday.info
```
Every line must say `MATCH`.

## 4. Split the funds across the role wallets (coordinator gets gas only)
```powershell
$env:NETWORK = "aevum"
pnpm -F @chainwork/sdk fund-wallets
```
Add `$env:DRY_RUN = "1"` first to preview.

## 5. Gate 1
```powershell
pnpm -F @chainwork/sdk gate1
```
Must end with `GATE 1 PASSED`. Every step prints an explorer link.

## 6. Commit the deployment
```powershell
git add deployments/aevum.json
git commit -m "deploy: Aevum testnet addresses"
git push
```
Then tell Claude, so `docs/CONTEXT.md`, the README and `packages/types` get the addresses.

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
