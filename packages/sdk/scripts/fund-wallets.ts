/**
 * Split the deployer's tQDAY and tUSD8 across the demo role wallets. The coordinator gets gas
 * but **no tUSD8**: it must hire on credit, which is the point of the demo.
 *
 *   NETWORK=aevum CHAINWORK_KEYSTORE_PASSWORD=… pnpm -F @chainwork/sdk fund-wallets   (keys from .keys/)
 *
 * Optional: GAS_EACH (tQDAY per wallet, default 0.1 ≈ 500 txs at 1 gwei), DRY_RUN=1.
 */
import { formatEther, parseEther } from "viem";
import { fiatTokenV2_2Abi } from "@chainwork/types/abis";
import { formatUnits, toUnits } from "../src/index.js";
import { ROLES, setup, type Role } from "./env.js";

// tUSD8 per role (base units). Sized for a 0.10-tUSD8 demo tree with bonds and a challenge.
const TUSD8_PLAN: Partial<Record<Role, bigint>> = {
  CLIENT: toUnits("0.40"),
  SPECIALIST_DATA: toUnits("0.05"),
  SPECIALIST_BAD: toUnits("0.05"),
  BACKUP: toUnits("0.05"),
  WATCHER: toUnits("0.03"),
};

async function main() {
  const { network, cfg, dep, publicClient, key, wallet, explorer } = setup();
  const deployer = wallet("DEPLOYER");
  const from = deployer.account.address;
  const gasEach = parseEther(process.env.GAS_EACH ?? "0.1"); // ~500 txs each at 1 gwei
  const dry = process.env.DRY_RUN === "1";

  const [gas, usd] = await Promise.all([
    publicClient.getBalance({ address: from }),
    publicClient.readContract({ address: cfg.token, abi: fiatTokenV2_2Abi, functionName: "balanceOf", args: [from] }),
  ]);
  console.log(`[${network}] deployer ${from}: ${formatEther(gas)} tQDAY, ${formatUnits(usd)} tUSD8`);

  const recipients = ROLES.filter((r) => r !== "DEPLOYER").map((r) => [r, key(r).address] as const);
  const needGas = gasEach * BigInt(recipients.length);
  const needUsd = Object.values(TUSD8_PLAN).reduce((a, b) => a + (b ?? 0n), 0n);
  const accountUsd = dep.clientAccount ? toUnits("0.30") : 0n;
  if (gas < needGas) throw new Error(`Need ${formatEther(needGas)} tQDAY for gas, have ${formatEther(gas)}. Lower GAS_EACH.`);
  if (usd < needUsd + accountUsd) {
    console.warn(`Only ${formatUnits(usd)} tUSD8 (plan needs ${formatUnits(needUsd + accountUsd)}); scaling the plan down.`);
  }
  const scale = (v: bigint) => (usd >= needUsd + accountUsd ? v : (v * usd) / (needUsd + accountUsd));

  for (const [role, to] of recipients) {
    const have = await publicClient.getBalance({ address: to });
    if (have < gasEach / 2n) {
      console.log(`  ${role.padEnd(16)} ${to}  +${formatEther(gasEach)} tQDAY`);
      if (!dry) {
        const h = await deployer.sendTransaction({ to, value: gasEach });
        await publicClient.waitForTransactionReceipt({ hash: h });
        console.log(`    ${explorer(h)}`);
      }
    }
    const amt = TUSD8_PLAN[role];
    if (amt) {
      const v = scale(amt);
      console.log(`  ${role.padEnd(16)} ${to}  +${formatUnits(v)} tUSD8`);
      if (!dry && v > 0n) {
        const h = await deployer.writeContract({ address: cfg.token, abi: fiatTokenV2_2Abi, functionName: "transfer", args: [to, v] });
        await publicClient.waitForTransactionReceipt({ hash: h });
        console.log(`    ${explorer(h)}`);
      }
    }
  }
  if (dep.clientAccount && accountUsd > 0n) {
    const v = scale(accountUsd);
    console.log(`  CLIENT AgentAccount ${dep.clientAccount}  +${formatUnits(v)} tUSD8`);
    if (!dry && v > 0n) {
      const h = await deployer.writeContract({ address: cfg.token, abi: fiatTokenV2_2Abi, functionName: "transfer", args: [dep.clientAccount, v] });
      await publicClient.waitForTransactionReceipt({ hash: h });
      console.log(`    ${explorer(h)}`);
    }
  }
  console.log("COORDINATOR stays at 0 tUSD8 (gas only).");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
