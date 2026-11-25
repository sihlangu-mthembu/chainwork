#!/usr/bin/env python3
"""
Prove that the contracts deployed on a chain are exactly this repository's source.

Aevum's explorer can't verify source code, so this does it locally:
  1. builds the contracts with the pinned settings in foundry.toml (solc 0.8.28, shanghai, 200 runs)
  2. fetches each deployed address's runtime bytecode with `cast code`
  3. masks only the immutable slots (constructor-set addresses, listed by the compiler) in both
  4. compares byte for byte, including the metadata hash (which commits to the exact source files)

Usage:  scripts/verify-bytecode.sh deployments/aevum.json https://rpc-test.qday.info
Exit code 0 only if every contract matches.
"""
import json
import os
import subprocess
import sys

CONTRACTS = {
    "escrow": ("contracts/src/ChainworkEscrow.sol", "ChainworkEscrow"),
    "reputation": ("contracts/src/ReputationRegistry.sol", "ReputationRegistry"),
    "budgetGuard": ("contracts/src/BudgetGuardHook.sol", "BudgetGuardHook"),
    "hashVerifier": ("contracts/src/verifiers/HashVerifier.sol", "HashVerifier"),
    "signedDataVerifier": ("contracts/src/verifiers/SignedDataVerifier.sol", "SignedDataVerifier"),
    "clientAccount": ("contracts/src/AgentAccount.sol", "AgentAccount"),
}


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout.strip()


def artifact(src, name):
    path = os.path.join("out", os.path.basename(src), f"{name}.json")
    with open(path) as f:
        return json.load(f)


def mask(code_hex, refs):
    b = bytearray(bytes.fromhex(code_hex[2:] if code_hex.startswith("0x") else code_hex))
    for ranges in refs.values():
        for r in ranges:
            for k in range(r["start"], r["start"] + r["length"]):
                if k < len(b):
                    b[k] = 0
    return bytes(b)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    deployment_path, rpc = sys.argv[1], sys.argv[2]
    forge = os.environ.get("FORGE", "forge")
    cast = os.environ.get("CAST", "cast")
    extra = os.environ.get("FORGE_BUILD_ARGS", "").split()
    with open(deployment_path) as f:
        dep = json.load(f)

    print(f"Building with pinned settings (foundry.toml)...")
    run([forge, "build", *extra])
    settings = artifact(*CONTRACTS["escrow"])["metadata"]["settings"]
    compiler = artifact(*CONTRACTS["escrow"])["metadata"]["compiler"]["version"]
    print(f"  solc {compiler}, evm {settings.get('evmVersion')}, optimizer runs {settings['optimizer']['runs']}")

    ok = True
    for key, (src, name) in CONTRACTS.items():
        addr = dep.get(key)
        if not addr or int(addr, 16) == 0:
            continue
        art = artifact(src, name)
        local = art["deployedBytecode"]["object"]
        refs = art["deployedBytecode"].get("immutableReferences", {})
        onchain = run([cast, "code", addr, "--rpc-url", rpc])
        a, b = mask(local, refs), mask(onchain, refs)
        n_imm = sum(r["length"] for rs in refs.values() for r in rs)
        if a == b:
            print(f"  MATCH     {name:<20} {addr}  ({len(b)} bytes, {n_imm} immutable bytes masked)")
        else:
            ok = False
            same_len = len(a) == len(b)
            first = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), None)
            print(f"  MISMATCH  {name:<20} {addr}  local {len(a)} bytes vs chain {len(b)} bytes"
                  f"{'' if same_len else ' (length differs)'}; first difference at byte {first}")
    print("All deployed contracts match this source." if ok else "Some contracts do NOT match.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
