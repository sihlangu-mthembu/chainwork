/**
 * Gate 1: a real job on Aevum, end to end, with explorer links for every step.
 *   client signs (no gas) → relayer funds via receiveWithAuthorization → provider accepts with a
 *   permit bond → provider submits → window passes → anyone finalizes → provider paid.
 *
 *   NETWORK=aevum CHAINWORK_KEYSTORE_PASSWORD=… pnpm -F @chainwork/sdk gate1   (keys from .keys/)
 *
 * Optional: BUDGET (tUSD8, default 0.01), WINDOW (seconds, default 30).
 */
import { formatEther, keccak256, stringToBytes } from "viem";
import { fiatTokenV2_2Abi } from "@chainwork/types/abis";
import { JobStatus } from "@chainwork/types";
import { buildTerms, formatUnits, readTree, signFunding, toUnits } from "../src/index.js";
import { setup } from "./env.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { network, cfg, publicClient, key, as, explorer } = setup();
  const relayer = as("DEPLOYER");
  const provider = as("SPECIALIST_DATA");
  const client = key("CLIENT");
  const providerAddr = key("SPECIALIST_DATA").address;
  const budget = toUnits(process.env.BUDGET ?? "0.01");
  const window = Number(process.env.WINDOW ?? "30");
  const bal = (a: `0x${string}`) =>
    publicClient.readContract({ address: cfg.token, abi: fiatTokenV2_2Abi, functionName: "balanceOf", args: [a] });

  console.log(`[${network}] escrow ${cfg.escrow}`);
  console.log(`client ${client.address}: ${formatUnits(await bal(client.address))} tUSD8, ${formatEther(await publicClient.getBalance({ address: client.address }))} tQDAY (needs none)`);
  const providerStart = await bal(providerAddr);

  const now = Number((await publicClient.getBlock()).timestamp);
  const description = "Gate 1: fetch EUR/USD reference rate";
  const terms = buildTerms({
    provider: providerAddr,
    evaluator: key("EVALUATOR").address,
    budget,
    description,
    expiresIn: 1800,
    challengeWindow: window,
    now,
  });
  const quote = await relayer.providerNumbers(providerAddr, budget);
  console.log(`quote: ${formatUnits(budget)} tUSD8, provider bond ${formatUnits(quote.bond)}, worst-case loss ${formatUnits(quote.worstCaseLoss)}`);

  const sig = await signFunding(client, cfg, terms, { validBefore: BigInt(now + 600) });
  console.log("1. client signed ReceiveWithAuthorization (nonce = terms hash), no gas");

  const funded = await relayer.fund(sig, description);
  console.log(`2. relayer funded job #${funded.jobId}: ${explorer(funded.hash)}`);

  const acc = await provider.accept(funded.jobId);
  console.log(`3. provider accepted, bond ${formatUnits(acc.bond)} via permit: ${explorer(acc.hash)}`);

  const out = keccak256(stringToBytes('{"pair":"EURUSD","rate":"1.0842","v":1}'));
  const sub = await provider.submit(funded.jobId, out);
  console.log(`4. provider submitted deliverable ${out}: ${explorer(sub.hash)}`);

  for (;;) {
    const left = await relayer.windowRemaining(funded.jobId, Number((await publicClient.getBlock()).timestamp));
    if (left === 0) break;
    process.stdout.write(`   challenge window: ${left}s left\r`);
    if (network === "local") {
      await publicClient.request({ method: "evm_increaseTime" as never, params: [left + 1] as never });
      await publicClient.request({ method: "evm_mine" as never, params: [] as never });
    } else {
      await sleep(Math.min(left, 5) * 1000);
    }
  }
  const fin = await relayer.finalize(funded.jobId);
  console.log(`\n5. window passed unchallenged, finalized: ${explorer(fin.hash)}`);

  const tree = await readTree(relayer, funded.jobId);
  const gained = (await bal(providerAddr)) - providerStart;
  console.log(`job #${funded.jobId}: ${JobStatus[tree.job.status]} (${tree.ui}); provider net +${formatUnits(gained)} tUSD8`);
  if (tree.job.status !== JobStatus.Completed || gained !== budget) throw new Error("Gate 1 FAILED");
  console.log("GATE 1 PASSED");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
