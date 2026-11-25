<#
  Chainwork on Aevum, start to finish, from Windows PowerShell in C:\dev\chainwork.

    .\scripts\aevum.ps1            # everything: checks, deploy, verify, fund, Gate 1, demo
    .\scripts\aevum.ps1 -Step demo # one step: check | deploy | verify | fund | gate1 | demo | status

  Your keystore password is asked once and kept only in this PowerShell process.
  Steps that already happened are skipped (an existing deployments\aevum.json is never redeployed).
#>
param(
  [ValidateSet("all", "check", "deploy", "verify", "fund", "gate1", "demo", "status")]
  [string]$Step = "all"
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$Rpc = "https://rpc-test.qday.info"
$Token = "0x456569838f1d43009A91ebA4263147Afd7233483"
$Deployer = "0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1"
$ClientOwner = "0xbE213deEEf489afDf67842F411472Aa90f8f8D77"
$Log = "aevum-run.log"

function Say($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Yellow }
function Done($text) { Write-Host "   $text" -ForegroundColor Green }
function Fail($text) { Write-Host "   $text" -ForegroundColor Red; exit 1 }

function Need-Password {
  if (-not $env:CHAINWORK_KEYSTORE_PASSWORD) {
    $secure = Read-Host "Keystore password (from the setup message)" -AsSecureString
    $env:CHAINWORK_KEYSTORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
}

function Check {
  Say "Checking tools and the deployer's balance"
  foreach ($tool in "git", "node", "pnpm", "forge", "cast") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool is not installed or not on PATH." }
  }
  $chain = (cast chain-id --rpc-url $Rpc).Trim()
  if ($chain -ne "44005") { Fail "The RPC answered chain $chain, expected 44005." }
  $gas = [decimal](cast balance $Deployer --rpc-url $Rpc --ether)
  $usd = [decimal]((cast call $Token "balanceOf(address)(uint256)" $Deployer --rpc-url $Rpc).Split(" ")[0]) / 1000000
  Done "Aevum reachable (chain 44005). Deployer $Deployer has $gas tQDAY and $usd tUSD8."
  if ($gas -lt 0.5) { Fail "The deployer needs at least 0.5 tQDAY. Send some to $Deployer and run this again." }
  if ($usd -lt 0.8) { Fail "The deployer needs at least 0.8 tUSD8. Send some to $Deployer and run this again." }
  if (-not (Test-Path ".keys\deployer")) { Fail "No .keys\deployer keystore here. Run this from C:\dev\chainwork." }
}

function Deploy {
  if (Test-Path "deployments\aevum.json") { Done "Already deployed (deployments\aevum.json exists): skipping."; return }
  Say "Deploying the contracts to Aevum"
  Need-Password
  $env:ACCOUNT_OWNER = $ClientOwner
  forge script contracts/script/Deploy.s.sol:DeployAevum --rpc-url $Rpc --broadcast --legacy --slow `
    --keystore .keys/deployer --password $env:CHAINWORK_KEYSTORE_PASSWORD 2>&1 | Tee-Object -Append $Log | Select-String -Pattern "Error|ONCHAIN EXECUTION|Contract Address|deployed" | ForEach-Object { "   $_" }
  if (-not (Test-Path "deployments\aevum.json")) { Fail "Deploy did not write deployments\aevum.json. See $Log." }
  Done "Deployed. Addresses are in deployments\aevum.json."
}

function Verify {
  Say "Checking the deployed bytecode is exactly this source"
  $py = @("python", "py", "python3") | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
  if (-not $py) { Done "Python not found: skipped here. GitHub runs the same check when you push deployments\aevum.json."; return }
  & $py scripts/verify_bytecode.py deployments/aevum.json $Rpc 2>&1 | Tee-Object -Append $Log
  if ($LASTEXITCODE -ne 0) { Fail "Bytecode check failed. See $Log." }
  Done "Every contract matches."
}

function Fund {
  Say "Sharing gas and tUSD8 across the role wallets (the coordinator gets gas only)"
  Need-Password
  $env:NETWORK = "aevum"
  if (-not $env:GAS_EACH) { $env:GAS_EACH = "0.05" }
  pnpm -s -F @chainwork/sdk fund-wallets 2>&1 | Tee-Object -Append $Log
  if ($LASTEXITCODE -ne 0) { Fail "Funding failed. See $Log." }
  Done "Wallets funded."
}

function Gate1 {
  Say "Gate 1: one paid job settles on Aevum"
  Need-Password
  $env:NETWORK = "aevum"
  pnpm -s -F @chainwork/sdk gate1 2>&1 | Tee-Object -Append $Log
  if ($LASTEXITCODE -ne 0) { Fail "Gate 1 failed. See $Log." }
  Done "Gate 1 passed."
}

function Demo {
  Say "The full demo on Aevum: seed, zero-capital tree, challenge, ghosting, injection, kill switch (about 15 minutes)"
  Need-Password
  $env:NETWORK = "aevum"
  Remove-Item -Recurse -Force "apps\agents\data" -ErrorAction SilentlyContinue
  pnpm -s -F agents start all 2>&1 | Tee-Object -Append $Log | Select-String -Pattern "^(PASS|FAIL)|scenario\.|error" | ForEach-Object { "   $_" }
  if ($LASTEXITCODE -ne 0) { Fail "A scenario failed. See $Log." }
  Done "All scenarios passed on Aevum."
}

function Status { node scripts/aevum-status.mjs }

Write-Host "Chainwork on Aevum. A full log goes to $Log (no keys or password are written to it)."
switch ($Step) {
  "check" { Check }
  "deploy" { Check; Deploy }
  "verify" { Verify }
  "fund" { Fund }
  "gate1" { Gate1 }
  "demo" { Demo }
  "status" { Status }
  default { Check; Deploy; Verify; Fund; Gate1; Demo; Status }
}
Write-Host ""
Write-Host "Finished. Next: git add deployments/aevum.json aevum-run.log; git commit -m 'deploy: Aevum'; then tell Claude." -ForegroundColor Cyan
