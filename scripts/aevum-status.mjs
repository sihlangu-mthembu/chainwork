// Read-only snapshot of Chainwork on Aevum: chain, gas price, every role wallet's tQDAY and tUSD8,
// and the deployment if deployments/aevum.json exists. Safe to run anywhere: no keys.
//   node scripts/aevum-status.mjs            (writes Markdown to stdout)
import { existsSync, readFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://rpc-test.qday.info";
const TOKEN = "0x456569838f1d43009A91ebA4263147Afd7233483";
const WALLETS = {
  deployer: "0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1",
  client: "0xbE213deEEf489afDf67842F411472Aa90f8f8D77",
  coordinator: "0x28C0B52FAd3Ce860324C3DA7DfDdcD7b94cEA40A",
  "specialist-data": "0xa5130D2A006d13750Fbc2E7b66cad6Cb9ad9B5c3",
  "specialist-bad": "0x80Dec5f266418EB8ae26A6C2Ee592c9082E4c00d",
  backup: "0x7117c6741d15f794751C447Df5F96F48501D1DA9",
  watcher: "0xFCEB78c36c369d0C90a6c91d4498A1991Ed036bd",
  evaluator: "0x6024AaEC247E11c53c9799ED018D67Ee2B5373e4",
  "faucet wallet (Binance)": "0x4e6C1A711BcD426b223098Ea80064709Eb2f000a",
};
let id = 0;
async function rpc(method, params = []) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const fmt = (hex, dec) => {
  const v = BigInt(hex);
  const s = v.toString().padStart(dec + 1, "0");
  return `${s.slice(0, -dec)}.${s.slice(-dec).replace(/0+$/, "") || "0"}`;
};
const balanceOf = (a) => rpc("eth_call", [{ to: TOKEN, data: "0x70a08231" + a.slice(2).toLowerCase().padStart(64, "0") }, "latest"]);

const [chain, block, gas] = await Promise.all([rpc("eth_chainId"), rpc("eth_blockNumber"), rpc("eth_gasPrice")]);
const out = [`## Aevum status`, ``, `chain ${Number(chain)}, block ${Number(block)}, gas price ${Number(BigInt(gas)) / 1e9} gwei`, ``, `| wallet | address | tQDAY | tUSD8 |`, `|---|---|---|---|`];
for (const [name, a] of Object.entries(WALLETS)) {
  const [eth, usd] = await Promise.all([rpc("eth_getBalance", [a, "latest"]), balanceOf(a)]);
  out.push(`| ${name} | \`${a}\` | ${fmt(eth, 18)} | ${fmt(usd, 6)} |`);
}
if (existsSync("deployments/aevum.json")) {
  const dep = JSON.parse(readFileSync("deployments/aevum.json", "utf8"));
  out.push("", "### Deployment", "");
  for (const [k, v] of Object.entries(dep)) {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) continue;
    const code = await rpc("eth_getCode", [v, "latest"]);
    out.push(`- ${k}: \`${v}\` ${code.length > 2 ? `(${(code.length - 2) / 2} bytes of code)` : "(no code!)"}`);
  }
} else out.push("", "No `deployments/aevum.json` yet: contracts not deployed to Aevum.");
console.log(out.join("\n"));
