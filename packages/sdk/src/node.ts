/**
 * Node-only helpers (not imported by the browser bundle): load agent keys from encrypted
 * Web3 Secret Storage (V3) keystores, the format Foundry (`cast wallet import`) and MetaMask use.
 *
 * Keys never sit in plaintext on disk or in .env: each agent loads its keystore with a password
 * supplied at runtime (environment variable, OS keychain or a secrets manager).
 */
import { createDecipheriv, scryptSync, pbkdf2Sync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bytesToHex, concatBytes, hexToBytes, keccak256, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

interface KeystoreV3 {
  version: number;
  crypto: {
    cipher: string;
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: "scrypt" | "pbkdf2";
    kdfparams: { dklen: number; salt: string; n?: number; r?: number; p?: number; c?: number; prf?: string };
    mac: string;
  };
}

const h = (s: string): Uint8Array => hexToBytes((s.startsWith("0x") ? s : `0x${s}`) as Hex);

/** Decrypt a V3 keystore JSON string. Throws "wrong password" on MAC mismatch. */
export function decryptKeystore(json: string, password: string): Hex {
  const ks = JSON.parse(json) as KeystoreV3;
  const c = ks.crypto;
  if (ks.version !== 3) throw new Error("Unsupported keystore version");
  if (c.cipher !== "aes-128-ctr") throw new Error(`Unsupported cipher ${c.cipher}`);
  const salt = Buffer.from(h(c.kdfparams.salt));
  const dklen = c.kdfparams.dklen;
  let dk: Buffer;
  if (c.kdf === "scrypt") {
    const { n = 262144, r = 8, p = 1 } = c.kdfparams;
    dk = scryptSync(password, salt, dklen, { N: n, r, p, maxmem: 512 * 1024 * 1024 });
  } else {
    dk = pbkdf2Sync(password, salt, c.kdfparams.c ?? 262144, dklen, "sha256");
  }
  const ciphertext = h(c.ciphertext);
  const mac = keccak256(concatBytes([new Uint8Array(dk.subarray(16, 32)), ciphertext]));
  if (mac.slice(2).toLowerCase() !== c.mac.toLowerCase().replace(/^0x/, "")) {
    throw new Error("Keystore password is wrong (MAC mismatch).");
  }
  const decipher = createDecipheriv("aes-128-ctr", dk.subarray(0, 16), Buffer.from(h(c.cipherparams.iv)));
  const pk = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
  return bytesToHex(new Uint8Array(pk));
}

/** Load an account from `<dir>/<name>` (Foundry keystore file, no extension) or `<dir>/<name>.json`. */
export function loadKeystoreAccount(dir: string, name: string, password: string): PrivateKeyAccount {
  const candidates = [join(dir, name), join(dir, `${name}.json`)];
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error(`No keystore named "${name}" in ${dir}.`);
  return privateKeyToAccount(decryptKeystore(readFileSync(path, "utf8"), password));
}
