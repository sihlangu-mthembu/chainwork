#!/usr/bin/env python3
"""Regenerate packages/types/src/abis.ts from packages/types/abi/**.json (run from repo root)."""
import json
names=['IChainworkEscrow','IReputationRegistry','IBudgetGuardHook','IAgentAccount','IFiatTokenV2_2','IVerifier']
impl=['ChainworkEscrow','ReputationRegistry','BudgetGuardHook','AgentAccount','SignedDataVerifier']
out=['/**',' * Generated from packages/types/abi/*.json (do not edit by hand). Typed `as const` for viem.',' * Regenerate: python3 scripts/gen-abis.py','*/','']
for n in names:
    a=json.load(open(f'packages/types/abi/{n}.json'))
    out.append(f'export const {n[1].lower()+n[2:]}Abi = {json.dumps(a)} as const;\n')
for n in impl:
    a=json.load(open(f'packages/types/abi/impl/{n}.json'))
    out.append(f'export const {n[0].lower()+n[1:]}ImplAbi = {json.dumps(a)} as const;\n')
open('packages/types/src/abis.ts','w').write('\n'.join(out))
