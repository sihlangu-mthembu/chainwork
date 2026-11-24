#!/usr/bin/env bash
# Fresh local chain (anvil, shanghai, 1 s blocks) + deployment, then an agents command.
# Usage: scripts/demo-local.sh [all|seed|s1|s2|s3|s4|s5]   (default: all). Leaves anvil running
# when KEEP_CHAIN=1 so the dashboard can be pointed at it.
set -euo pipefail
cd "$(dirname "$0")/.."
export NETWORK=local NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}" no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"
for _ in $(seq 50); do (exec 3<>/dev/tcp/127.0.0.1/8545) 2>/dev/null || break; echo "port 8545 busy: stop the running chain first" >&2; exit 1; done
anvil --port 8545 --hardfork shanghai --block-time 1 --silent &
ANVIL_PID=$!
[ "${KEEP_CHAIN:-0}" = 1 ] || trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 50); do cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 && break; sleep 0.2; done
forge script contracts/script/Deploy.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast --offline >/dev/null 2>&1 \
  || forge script contracts/script/Deploy.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast >/dev/null
rm -rf apps/agents/data
cmd="${1:-all}"
if [ "$cmd" != all ] && [ "$cmd" != seed ]; then pnpm -s -F agents demo:seed; fi
pnpm -s -F agents start "$cmd"
