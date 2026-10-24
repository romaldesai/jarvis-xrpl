// Headless happy path + guardrail beats. Uses whatever rail SETTLEMENT_RAIL selects.
//   npm run demo:headless
// The "human approval" here is the operator running this script with --yes (or answering y).
import readline from "node:readline/promises";
import { createAgentFromEnv } from "../src/index";

const auto = process.argv.includes("--yes");
const agent = createAgentFromEnv();
const info = agent.rail.info();
const line = (s = "") => console.log(s);

line(`XRP2India headless demo  |  rail=${info.name}  network=${info.network}${info.simulatedChain ? "  [SIMULATED CHAIN]" : ""}`);
if (agent.killed()) {
  line("Kill switch is ON. Turn it off first: npm run kill -- off");
  process.exit(1);
}
const b0 = await agent.budget();
line(`CONTROL: per-payment cap ${b0.display.perTxCap} | 24h cap ${b0.display.dailyCap} (remaining ${b0.display.dailyRemaining}) | channel ${b0.display.channelRemaining ?? "n/a"} of ${b0.display.channelCap ?? "n/a"}`);
line();

const text = process.argv.find((a) => a.startsWith("--text="))?.slice(7) ?? "Send ₹5,000 to my mother in India";
line(`USER: "${text}"`);
const card = await agent.prepare(text);
line(`AGENT (${card.parser} parser): ${card.recipient} ${card.upiMasked ?? ""}  ${card.quote?.inr ?? ""}`);
if (card.quote) line(`  quote: ${card.quote.usd} + fee ${card.quote.fee} = ${card.quote.total} (${card.quote.rlusd})  ${card.quote.rate} [${card.quote.rateLabel}]`);
line(`POLICY: ${card.decision.allow ? "ALLOW" : "DENY"} [${card.decision.rule}] ${card.decision.reason}`);
if (card.status !== "awaiting_approval") process.exit(2);

let yes = auto;
if (!yes) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  yes = /^y/i.test(await rl.question("Approve this payment? [y/N] "));
  rl.close();
}
if (!yes) {
  agent.reject(card.id!);
  line("Rejected. Nothing moved.");
  process.exit(0);
}
const res = await agent.approve(card.id!, (step, d) => line(`  .. ${step}${d?.txHash ? ` ${d.txHash}` : ""}`));
if (!res.ok) {
  line(`FAILED [${res.rule}] ${res.error}`);
  process.exit(3);
}
line("PROVE:");
for (const p of res.settlement!.proofs) line(`  ${p.step.padEnd(14)} ${p.txHash}  ${p.explorerUrl ?? "(no public explorer for this network)"}`);
for (const e of res.settlement!.events) line(`  event ${e.name} ${JSON.stringify(e.args)}`);
line(`PAYOUT [${res.payout!.label}] ${res.payout!.amountInr} -> ${res.payout!.upiMasked} via UPI, ref ${res.payout!.reference}`);
line(`CONTROL after: 24h remaining ${res.budget.display.dailyRemaining} | channel remaining ${res.budget.display.channelRemaining ?? "n/a"}`);
line();

if (process.argv.includes("--guardrails")) {
  line('REJECTED 1 (over cap): "Send ₹50,000 to my mother"');
  const over = await agent.prepare("Send ₹50,000 to my mother");
  line(`  POLICY: DENY [${over.decision.rule}] ${over.decision.reason}`);
  line("  (on-chain over-cap revert proof: npm run prove:overcap)");
  line('REJECTED 2 (not allow-listed): "Send ₹500 to my landlord"');
  const who = await agent.prepare("Send ₹500 to my landlord");
  line(`  POLICY: DENY [${who.decision.rule}] ${who.decision.reason}`);
  line("REJECTED 3 (kill switch): prepare a payment, kill switch ON, then try to approve");
  const c = await agent.prepare("Send ₹1,000 to my mother");
  agent.setKill(true);
  const k = await agent.approve(c.id!);
  line(`  APPROVE: ${k.ok ? "settled (unexpected!)" : `refused [${k.rule}] ${k.error}`}`);
  agent.setKill(false);
  line();
}
line("AUDIT (last 8):");
for (const e of agent.auditTail(8)) line(`  ${e.ts} ${e.event.padEnd(7)} ${String(e.rule ?? "").padEnd(22)} ${e.txHash ?? e.reason ?? ""}`);
