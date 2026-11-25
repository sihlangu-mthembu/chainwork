// Build public/events.json: every escrow event since the deployment block, so the hosted
// dashboard opens with full history (replay, ledger, timeline) and only scans new blocks live.
// Pages in 999-block chunks (Aevum caps eth_getLogs at 1,000 blocks). Usage:
//   node scripts/snapshot-events.mjs <deployment.json> <rpc-url> [out=public/events.json]
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [depPath, rpcUrl, out = "public/events.json"] = process.argv.slice(2);
const dep = JSON.parse(readFileSync(depPath, "utf8"));
let id = 0;
async function rpc(method, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}
// Resume from a previous snapshot when there is one.
let logs = [];
let from = BigInt(dep.deployedAtBlock ?? 0);
if (existsSync(out)) {
  const prev = JSON.parse(readFileSync(out, "utf8"));
  if (prev.escrow?.toLowerCase() === dep.escrow.toLowerCase()) {
    logs = prev.logs;
    from = BigInt(prev.cursor) + 1n;
  }
}
const latest = BigInt(await rpc("eth_blockNumber", []));
for (let start = from; start <= latest; start += 999n) {
  const stop = start + 998n > latest ? latest : start + 998n;
  const got = await rpc("eth_getLogs", [{ address: dep.escrow, fromBlock: "0x" + start.toString(16), toBlock: "0x" + stop.toString(16) }]);
  for (const l of got) logs.push({ data: l.data, topics: l.topics, blockNumber: l.blockNumber, logIndex: l.logIndex, transactionHash: l.transactionHash });
}
writeFileSync(out, JSON.stringify({ escrow: dep.escrow, chainId: dep.chainId, cursor: latest.toString(), logs }) + "\n");
console.log(`events.json: ${logs.length} logs up to block ${latest}`);
