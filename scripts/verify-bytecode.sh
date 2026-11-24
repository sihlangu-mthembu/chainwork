#!/usr/bin/env bash
# Prove deployed bytecode == this repo's source (Aevum's explorer can't verify source).
# Usage: scripts/verify-bytecode.sh [deployments/aevum.json] [rpc-url]
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 scripts/verify_bytecode.py "${1:-deployments/aevum.json}" "${2:-https://rpc-test.qday.info}"
