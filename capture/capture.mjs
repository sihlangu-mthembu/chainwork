// Records what the live dashboard reads from Aevum (RPC replies, events.json) and screenshots
// the explorer and README, so the demo video can be filmed offline from real data.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const SITE = "https://sihlangu-mthembu.github.io/chainwork/";
const OUT = "out";
mkdirSync(OUT, { recursive: true });
const rpc = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: "dark" });
const page = await ctx.newPage();
page.on("response", async (res) => {
  const req = res.request();
  if (!req.url().includes("qday.info") || req.method() !== "POST") return;
  try { rpc.push({ url: req.url(), body: req.postData(), reply: await res.text() }); } catch {}
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (p, name, full = false) => { await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); console.log("shot", name); };

for (const job of [7, 11]) {
  await page.goto(`${SITE}#job=${job}`, { waitUntil: "networkidle" });
  await sleep(12000);
  await shot(page, `dash-job${job}`);
  await shot(page, `dash-job${job}-full`, true);
  for (const tab of ["Wallets", "All jobs", "Reputation", "Receipts", "Kill switches"]) {
    await page.getByRole("tab", { name: tab }).click();
    await sleep(5000);
    await shot(page, `desk-${job}-${tab.replace(/ /g, "_")}`, true);
  }
}
for (const [name, url] of [
  ["dash-root", SITE],
]) { await page.goto(url, { waitUntil: "networkidle" }); await sleep(10000); }
for (const f of ["events.json", "deployment.json"]) {
  const r = await page.request.get(SITE + f);
  writeFileSync(`${OUT}/${f}`, await r.body());
}
writeFileSync(`${OUT}/rpc.json`, JSON.stringify(rpc));
console.log("rpc calls", rpc.length);

const ex = await ctx.newPage();
for (const [name, url] of [
  ["tx-challenge", "https://explorer-test.qday.info/tx/0x55eeba69b878f8c0a7cdad7cfcb6c4102818b94e7bec01705e9fd649e2d6fb46"],
  ["tx-reject", "https://explorer-test.qday.info/tx/0x6daacfc7993d69cf961e72fc541034e85d39393df27609eb4c2425ea2a89eff0"],
  ["tx-settle7", "https://explorer-test.qday.info/tx/0x2eb5e2b0609d768a6eadfe27d6499458f3b236512fd0342958928822b9f23745"],
  ["addr-escrow", "https://explorer-test.qday.info/address/0xC8a46c937c993cDd7E6c865B38fb3b32c275AA43"],
  ["readme", "https://github.com/sihlangu-mthembu/chainwork"],
]) {
  try {
    await ex.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(15000);
    await shot(ex, name);
    await shot(ex, `${name}-full`, true);
  } catch (e) { console.log("fail", name, e.message); }
}
await browser.close();
