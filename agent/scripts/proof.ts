// Print a PROOF markdown block (public data only: addresses + tx hashes + explorer links). Never keys.
//   npm run proof                 -> stdout (paste back to the team)
//   npm run proof -- --write      -> also writes docs/PROOF.md
import fs from "node:fs";
import path from "node:path";
import { AuditLog, loadEnv, repoRoot } from "../src/index";

loadEnv();
const root = repoRoot();
const explorer = process.env.EVM_EXPLORER_URL || "https://explorer.testnet.xrplevm.org";
const depFile = path.join(root, "contracts", "deployments", "xrplevmTestnet.json");
const out: string[] = [];
const tx = (h: string) => `[\`${h.slice(0, 12)}…${h.slice(-6)}\`](${explorer}/tx/${h})`; // secret-scan:allow
const addr = (a: string) => `[\`${a}\`](${explorer}/address/${a})`;

out.push("# XRP2India: on-chain proof (XRPL EVM Sidechain testnet, chain 1449000)", "");
out.push(`Generated ${new Date().toISOString()} by \`npm run proof\`. Public data only.`, "");
if (!fs.existsSync(depFile)) {
  out.push("_No testnet deployment yet. Run `npm run testnet`._");
} else {
  const d = JSON.parse(fs.readFileSync(depFile, "utf8"));
  out.push("## Contracts", "", "| Contract | Address |", "| --- | --- |");
  out.push(`| ${d.rlusdIsMock ? `MockRLUSD (${d.rlusdDecimals}dp, labelled "mock RLUSD")` : "RLUSD"} | ${addr(d.rlusd)} |`);
  out.push(`| ParticipantRegistry (KYA) | ${addr(d.registry)} |`, `| PaymentLedger | ${addr(d.ledger)} |`);
  out.push(`| Agent (KYA-registered) | ${addr(d.agent)} |`, `| Payout (bound in registry) | ${addr(d.payout)} |`);
  if (d.funder) out.push(`| Channel funder | ${addr(d.funder)} |`);
  out.push("", `Channel #${d.channelId ?? "?"} cap: ${d.capDisplay ?? "?"}`, "");
  out.push("## Setup transactions", "", "| Step | Tx |", "| --- | --- |");
  for (const [k, h] of Object.entries<string>(d.txs ?? {})) if (k !== "overCapRevert") out.push(`| ${k} | ${tx(h)} |`);
  out.push("", "## REJECTED on-chain: over-cap redeem", "");
  out.push(d.txs?.overCapRevert ? `Voucher for cap + 1 base unit, mined and reverted with \`OverCap\` (status 0): ${tx(d.txs.overCapRevert)}` : "_Not run yet: `npm run prove:overcap`._");
}
const auditFile = path.resolve(root, process.env.AUDIT_LOG_PATH || "audit.jsonl");
const ev = fs.existsSync(auditFile) ? new AuditLog(auditFile).read() : [];
const paid = ev.filter((e) => (e.event === "redeem" || e.event === "settle") && e.txHash && e.explorerUrl);
out.push("", "## Payments (from audit.jsonl)", "");
if (!paid.length) out.push("_No testnet payments yet. Run `npm run demo:headless`._");
else {
  out.push("| Time (UTC) | Step | Amount | Tx |", "| --- | --- | --- | --- |");
  for (const e of paid) out.push(`| ${e.ts.slice(0, 19).replace("T", " ")} | ${e.event === "redeem" ? "redeemVoucher" : "settle"} | $${(Number(e.totalCents) / 100).toFixed(2)} | ${tx(e.txHash!)} |`);
}
const denials = ev.filter((e) => e.event === "deny").slice(-5);
if (denials.length) {
  out.push("", "## REJECTED by policy (latest)", "", "| Time (UTC) | Rule | Reason |", "| --- | --- | --- |");
  for (const e of denials) out.push(`| ${e.ts.slice(0, 19).replace("T", " ")} | \`${e.rule}\` | ${e.reason} |`);
}
const md = out.join("\n") + "\n";
console.log(md);
if (process.argv.includes("--write")) {
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "PROOF.md"), md);
  console.log("wrote docs/PROOF.md");
}
