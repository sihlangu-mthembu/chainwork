// Point the dashboard at a local anvil deployment (scripts/demo-local.sh with KEEP_CHAIN=1) and start vite.
import { copyFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
mkdirSync("public", { recursive: true });
copyFileSync("../../deployments/local.json", "public/deployment.json");
const env = { ...process.env, VITE_CHAIN_ID: "31337", VITE_RPC_URL: "http://127.0.0.1:8545", VITE_EXPLORER_URL: "http://127.0.0.1:8545", VITE_FROM_BLOCK: "1" };
spawn("npx", ["vite", "--port", "5173"], { stdio: "inherit", env, shell: process.platform === "win32" });
