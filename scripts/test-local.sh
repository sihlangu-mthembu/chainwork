#!/usr/bin/env bash
# Run each package's tests against its own fresh local chain (anvil, shanghai, 1 s blocks) so
# suites never share nonces, reputation or job ids. Usage: scripts/test-local.sh [pkg-filter ...]
set -euo pipefail
cd "$(dirname "$0")/.."
export CHAINWORK_LOCAL=1 NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}" no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"
PKGS=("$@")
[ ${#PKGS[@]} -eq 0 ] && PKGS=(@chainwork/sdk @chainwork/checks @chainwork/service-kit facilitator indexer worker-kit watcher evaluator agents dashboard)
BLOCK_TIME="${BLOCK_TIME:-1}"
fail=0
ANVIL_PID=""
stop_anvil() { if [ -n "$ANVIL_PID" ]; then kill "$ANVIL_PID" 2>/dev/null || true; wait "$ANVIL_PID" 2>/dev/null || true; ANVIL_PID=""; fi; }
trap stop_anvil EXIT
for p in "${PKGS[@]}"; do
  stop_anvil
  # The SDK suite drives time itself (evm_increaseTime + mine); services need real 1 s blocks so
  # challenge windows close while they poll.
  if [ "$p" = "@chainwork/sdk" ]; then MINING=(); else MINING=(--block-time "$BLOCK_TIME"); fi
  for _ in $(seq 50); do (exec 3<>/dev/tcp/127.0.0.1/8545) 2>/dev/null || break; sleep 0.2; done
  anvil --port 8545 --hardfork shanghai "${MINING[@]}" --silent &
  ANVIL_PID=$!
  for _ in $(seq 50); do cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 && break; sleep 0.2; done
  forge script contracts/script/Deploy.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast --offline >/dev/null 2>&1 \
    || forge script contracts/script/Deploy.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast >/dev/null
  echo "=== $p"
  pnpm -F "$p" test || fail=1
done
stop_anvil
exit $fail
