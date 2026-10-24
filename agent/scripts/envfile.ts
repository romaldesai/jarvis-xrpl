// Tiny .env editor. Writes values without ever printing them.
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../src/factory";

export const envPath = () => path.join(repoRoot(), ".env");

export function ensureEnvFile(): string {
  const p = envPath();
  if (!fs.existsSync(p)) {
    fs.copyFileSync(path.join(repoRoot(), ".env.example"), p);
    fs.chmodSync(p, 0o600);
    console.log("created .env from .env.example");
  }
  return p;
}

const isUnset = (v: string | undefined) => v === undefined || v === "" || /^YOUR_.*_HERE$/.test(v);

export function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(ensureEnvFile(), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Set KEY=value if unset (or force). Returns true if written. */
export function upsertEnv(key: string, value: string, force = false): boolean {
  const p = ensureEnvFile();
  const text = fs.readFileSync(p, "utf8");
  const cur = readEnv()[key];
  if (!isUnset(cur) && !force) return false;
  const re = new RegExp(`^${key}=.*$`, "m");
  const next = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\n?$/, "\n")}${key}=${value}\n`;
  fs.writeFileSync(p, next, { mode: 0o600 });
  return true;
}
