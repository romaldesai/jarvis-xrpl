#!/usr/bin/env node
// Secret scanner for pre-commit / pre-push / CI.
// Blocks: 0x-prefixed 64-hex strings (EVM private keys), XRPL family seeds,
// PEM private keys, common API tokens. Prints file:line and rule only,
// never the matched value. Exits 1 on any hit.
//
// Allowed: lines containing a placeholder marker (YOUR_..._HERE, REPLACE_ME)
// or an explicit "secret-scan:allow" comment, and 64-hex values that are
// part of a /tx/ explorer URL (public transaction hashes).
import { execSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";

const mode = process.argv[2] || "--staged"; // --staged | --all | --push

const RULES = [
  { name: "evm-private-key (0x + 64 hex)", re: /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/ },
  { name: "xrpl-seed", re: /(?<![A-Za-z0-9])s[1-9A-HJ-NP-Za-km-z]{28,30}(?![A-Za-z0-9])/ },
  { name: "pem-private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { name: "openai-key", re: /sk-[A-Za-z0-9]{32,}/ },
  { name: "github-token", re: /(ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]{20,}/ },
  { name: "mnemonic-env", re: /MNEMONIC\s*=\s*["']?\w+( \w+){11,}/ },
];
const ALLOW = /(YOUR_[A-Z0-9_]+_HERE|REPLACE_ME|secret-scan:allow)/;
const TX_URL = /\/tx\/0x[0-9a-fA-F]{64}/g;
const SKIP = /(^|\/)(node_modules|\.git|\.next|artifacts|cache|typechain-types|coverage|dist)\//;
const SKIP_EXT = /\.(png|jpg|jpeg|gif|ico|woff2?|ttf|lock|pdf)$|package-lock\.json$/;

function files() {
  if (mode === "--all") return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  if (mode === "--push") {
    let range = "";
    try { range = execSync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
    const cmd = range ? `git diff --name-only --diff-filter=ACMR ${range}...HEAD` : "git ls-files";
    return execSync(cmd, { encoding: "utf8" }).split("\n").filter(Boolean);
  }
  return execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" }).split("\n").filter(Boolean);
}

function content(f) {
  if (mode === "--staged") {
    try { return execSync(`git show :"${f}"`, { encoding: "utf8", maxBuffer: 64 << 20 }); } catch { return ""; }
  }
  if (!existsSync(f) || statSync(f).isDirectory()) return "";
  return readFileSync(f, "utf8");
}

let hits = 0;
for (const f of files()) {
  if (SKIP.test(f) || SKIP_EXT.test(f)) continue;
  if (/(^|\/)\.env$|\.env\.(?!example$)/.test(f)) {
    console.error(`BLOCKED ${f}: env file must never be committed`);
    hits++;
    continue;
  }
  const lines = content(f).split("\n");
  lines.forEach((raw, i) => {
    if (ALLOW.test(raw)) return;
    const line = raw.replace(TX_URL, "/tx/<hash>");
    for (const r of RULES) {
      if (r.re.test(line)) {
        console.error(`BLOCKED ${f}:${i + 1}: ${r.name}`);
        hits++;
      }
    }
  });
}
if (hits) {
  console.error(`\nsecret-scan: ${hits} hit(s). Remove the value or, if it is public (e.g. a tx hash), add "secret-scan:allow" on that line.`);
  process.exit(1);
}
console.log(`secret-scan (${mode}): clean`);
