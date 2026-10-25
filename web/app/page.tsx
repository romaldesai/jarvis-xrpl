"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AP4M_EXPLORER_TX, AP4M_PROOF } from "@/lib/ap4m-proof";

type Budget = {
  perTxCapCents: string;
  dailyCapCents: string;
  spentTodayCents: string | null;
  dailyRemainingCents: string | null;
  channel: { channelId: string; capCents: string; redeemedCents: string; remainingCents: string } | null;
  display: { perTxCap: string; dailyCap: string; dailyRemaining: string | null; channelCap: string | null; channelRemaining: string | null };
};
type RailInfo = { name: string; network: string; explorerUrl: string | null; simulatedChain: boolean; agentAddress?: string; ledger?: string; channelId?: string };
type Status = { rail: RailInfo; killed: boolean; budget: Budget; llm: boolean };
type Quote = { inr: string; usd: string; fee: string; total: string; rlusd: string; rate: string; rateSource: string; rateLabel?: string; rateAsOf: string };
type Card = {
  id: string | null;
  status: "awaiting_approval" | "denied" | "not_understood";
  text: string;
  parser: string | null;
  recipient: string | null;
  upiMasked: string | null;
  quote: Quote | null;
  decision: { allow: boolean; rule: string; reason: string };
  budget: Budget;
};
type Proof = { step: string; txHash: string; explorerUrl: string | null };
type Result = {
  ok: boolean;
  id: string;
  rule?: string;
  error?: string;
  settlement?: { rail: string; simulatedChain: boolean; proofs: Proof[]; events: { name: string; args: Record<string, string> }[]; payout: string; amountDisplay: string };
  payout?: { label: string; upiMasked: string; amountInr: string; reference: string; note: string };
  budget: Budget;
};
type AuditEvent = { ts: string; event: string; id?: string; rule?: string; reason?: string; txHash?: string; explorerUrl?: string; totalCents?: string };
type Msg = { who: "user" | "agent"; text: string; deny?: boolean };

const STEPS = [
  { key: "approved", label: "You approved (one gate → typed ApprovedAction)" },
  { key: "signing", label: "Agent signs EIP-712 voucher (cumulative amount)" },
  { key: "redeemed", label: "PaymentLedger.redeemVoucher → VoucherRedeemed" },
  { key: "settled", label: "PaymentLedger.settle → ClaimPaid + SettlementRecorded" },
  { key: "payout", label: "UPI payout to recipient (SIMULATED)" },
];
const XRPL_STEPS = [
  { key: "approved", label: "You approved (one gate → typed ApprovedAction)" },
  { key: "signing", label: "Sign XRPL Payment (testnet)" },
  { key: "validated", label: "submitAndWait → tesSUCCESS in a validated ledger" },
  { key: "payout", label: "UPI payout to recipient (SIMULATED)" },
];
const ORDER: Record<string, number> = { approved: 0, signing: 1, redeeming: 1, redeemed: 2, settling: 2, settled: 3, submitting: 1, validated: 2 };

const cents = (c: string | null | undefined) => (c == null ? 0 : Number(c) / 100);
// 18-decimal base units -> "57.81 RLUSD" (display only; exact integers stay on-chain and in the audit log)
const fmtArg = (k: string, v: string) => {
  if (/^\d{13,}$/.test(v) && /amount|delta|settled|redeemed|cap/i.test(k)) {
    const s = v.padStart(19, "0");
    return `${BigInt(s.slice(0, -18)).toLocaleString("en-US")}.${s.slice(-18, -16)} RLUSD`;
  }
  return short(v);
};
const short = (h: string) => (h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h);
const addr = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const TxLink = ({ label, hash }: { label: string; hash: string }) => (
  <a className="mono" href={AP4M_EXPLORER_TX + hash} target="_blank" rel="noreferrer" title={hash}>{label} {short(hash)}</a>
);
const EXAMPLES = ["Send ₹5,000 to my mother in India", "Send ₹50,000 to my mother in India", "Send $25 to bhai", "Send ₹500 to my landlord"];

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(EXAMPLES[0]);
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ at: number; failed: boolean; hashes: Record<string, string> } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      const j = await r.json();
      if (j.setupError) {
        setSetupError(`${j.setupError}. ${j.hint ?? ""}`);
        return;
      }
      setSetupError(null);
      setStatus(j);
      const a = await fetch("/api/audit", { cache: "no-store" }).then((x) => x.json());
      setAudit(a.events ?? []);
    } catch (e) {
      setSetupError(`Agent server unreachable (${(e as Error).message}). Is \`npm run dev\` running?`);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [msgs]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setResult(null);
    setProgress(null);
    setMsgs((m) => [...m, { who: "user", text }]);
    try {
      const r = await fetch("/api/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const c: Card & { setupError?: string; error?: string } = await r.json();
      if (c.setupError) throw new Error(c.setupError);
      if (c.error) throw new Error(c.error);
      setCard(c);
      if (c.status === "awaiting_approval")
        setMsgs((m) => [...m, { who: "agent", text: `I prepared ${c.quote?.inr} for your ${c.recipient} (${c.upiMasked}). Policy check passed. Nothing moves until you tap Approve.` }]);
      else if (c.status === "denied") setMsgs((m) => [...m, { who: "agent", deny: true, text: `Blocked by policy [${c.decision.rule}]: ${c.decision.reason}` }]);
      else setMsgs((m) => [...m, { who: "agent", deny: true, text: c.decision.reason }]);
    } catch (e) {
      setMsgs((m) => [...m, { who: "agent", deny: true, text: `Error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function approve() {
    if (!card?.id) return;
    setBusy(true);
    setProgress({ at: 0, failed: false, hashes: {} });
    let gotResult = false;
    const handle = (line: string) => {
      if (!line.trim()) return;
      const o = JSON.parse(line);
      if (o.step) setProgress((p) => ({ at: Math.max(p?.at ?? 0, ORDER[o.step] ?? 0), failed: false, hashes: o.txHash ? { ...(p?.hashes ?? {}), [o.step]: o.txHash } : p?.hashes ?? {} }));
      if (o.setupError || o.error) throw new Error(o.setupError ?? o.error);
      if (o.result) {
        gotResult = true;
        const r: Result = o.result;
        setResult(r);
        if (r.ok) {
          setProgress((p) => ({ at: 99, failed: false, hashes: p?.hashes ?? {} }));
          setMsgs((m) => [...m, { who: "agent", text: `Settled ${r.settlement?.amountDisplay}. ${r.payout?.amountInr} on its way to ${r.payout?.upiMasked} (SIMULATED UPI).` }]);
        } else {
          setProgress((p) => ({ at: p?.at ?? 0, failed: true, hashes: p?.hashes ?? {} }));
          setMsgs((m) => [...m, { who: "agent", deny: true, text: `Not sent [${r.rule}]: ${r.error}` }]);
        }
      }
    };
    try {
      const res = await fetch("/api/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: card.id }) });
      if (!res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          handle(line);
        }
      }
      handle(buf + dec.decode());
      if (!gotResult) throw new Error(`no result from server (HTTP ${res.status})`);
    } catch (e) {
      // Connection lost or server error: say so. If a redeem tx was already sent, the audit log and explorer show it.
      setProgress((p) => ({ at: p?.at ?? 0, failed: true, hashes: p?.hashes ?? {} }));
      setMsgs((m) => [...m, { who: "agent", deny: true, text: `Approval did not complete: ${(e as Error).message}. Check the audit log below before retrying.` }]);
    } finally {
      setCard(null);
      setBusy(false);
      refresh();
    }
  }

  async function reject() {
    if (!card?.id) return;
    // Nothing moves without Approve, so a failed reject call still leaves the payment unsent (it expires in 10 min).
    await fetch("/api/reject", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: card.id }) }).catch(() => undefined);
    setMsgs((m) => [...m, { who: "agent", text: "Rejected. Nothing moved." }]);
    setCard(null);
    refresh();
  }

  async function toggleKill() {
    const ok = await fetch("/api/kill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: !status?.killed }) }).then((r) => r.ok, () => false);
    if (!ok) setMsgs((m) => [...m, { who: "agent", deny: true, text: "Kill switch request failed. The badge shows the real state; use `npm run kill -- on` as a backup." }]);
    refresh();
  }

  const b = status?.budget;
  const ch = b?.channel;
  const chPct = ch ? (cents(ch.remainingCents) / Math.max(cents(ch.capCents), 0.01)) * 100 : 0;
  const dayPct = b ? (cents(b.dailyRemainingCents) / Math.max(cents(b.dailyCapCents), 0.01)) * 100 : 0;
  const steps = status?.rail.name === "xrpl" ? XRPL_STEPS : STEPS;

  return (
    <main className="wrap">
      <div className="top">
        <div>
          <div className="brand">
            XRP2<span>India</span>
          </div>
          <div className="sub">AI remittance agent · LLM proposes → policy decides → you approve → everything audited</div>
        </div>
        <div className="badges">
          {status && <span className={`badge ${status.rail.simulatedChain ? "sim" : "live"}`}>{status.rail.network}</span>}
          {status && <span className="badge">parser: {status.llm ? "LLM + regex fallback" : "regex (deterministic)"}</span>}
          <span className="badge sim">Testnet only · UPI payout SIMULATED</span>
          <button className={`kill ${status?.killed ? "on" : ""}`} onClick={toggleKill} disabled={!status}>
            {status?.killed ? "KILL SWITCH ON · tap to resume" : "Kill switch"}
          </button>
        </div>
      </div>

      {setupError && <div className="banner">Setup needed: {setupError}</div>}

      <section className="panel" style={{ marginBottom: 18 }}>
        <h3>Control · the agent can never exceed these</h3>
        <div className="control">
          <div className="stat">
            <div className="k">Prefunded channel remaining (on-chain cap)</div>
            <div className="v">{b?.display.channelRemaining ?? "n/a"}</div>
            <div className="s">of {b?.display.channelCap ?? "no channel on this rail"}{ch ? ` · channel #${ch.channelId}` : ""}</div>
            <div className="bar"><i style={{ width: `${chPct}%` }} /></div>
          </div>
          <div className="stat">
            <div className="k">24h budget remaining (policy)</div>
            <div className="v">{b?.display.dailyRemaining ?? "—"}</div>
            <div className="s">of {b?.display.dailyCap ?? "—"} per rolling 24h</div>
            <div className="bar"><i style={{ width: `${dayPct}%` }} /></div>
          </div>
          <div className="stat">
            <div className="k">Per-payment cap (policy)</div>
            <div className="v">{b?.display.perTxCap ?? "—"}</div>
            <div className="s">allow-listed recipients only</div>
          </div>
        </div>
      </section>

      <div className="grid">
        <div className="stack">
          <section className="panel">
            <h3>Chat</h3>
            <div className="chat" ref={chatRef}>
              {msgs.length === 0 && <div className="muted">Tell the agent what to send. Example: “Send ₹5,000 to my mother in India”.</div>}
              {msgs.map((m, i) => (
                <div key={i} className={`msg ${m.who} ${m.deny ? "deny" : ""}`}>{m.text}</div>
              ))}
            </div>
            <form className="inputrow" onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Send ₹5,000 to my mother in India" aria-label="Message" />
              <button className="primary" disabled={busy || !status}>Send</button>
            </form>
            <div className="chips">
              {EXAMPLES.map((x) => (
                <button key={x} className="chip" onClick={() => setInput(x)} type="button">{x}</button>
              ))}
            </div>

            {card && card.quote && (
              <div className="card">
                <div className="row"><span className="l">To</span><span><b style={{ textTransform: "capitalize" }}>{card.recipient}</b> · {card.upiMasked ?? "not on allow-list"}</span></div>
                <div className="row"><span className="l">They receive</span><span className="big">{card.quote.inr}</span></div>
                <div className="row"><span className="l">Principal</span><span>{card.quote.usd}</span></div>
                <div className="row"><span className="l">Fee</span><span>{card.quote.fee}</span></div>
                <div className="row"><span className="l">You pay</span><span><b>{card.quote.total}</b> = {card.quote.rlusd}</span></div>
                <div className="row"><span className="l">Rate</span><span>{card.quote.rate} <span className={`muted ${card.quote.rateSource === "demo" ? "warn" : ""}`}>({card.quote.rateLabel ?? card.quote.rateSource})</span></span></div>
                <div className={`policy ${card.decision.allow ? "ok" : "bad"}`}>
                  {card.decision.allow ? "✓" : "✕"} Policy [{card.decision.rule}] {card.decision.reason}
                </div>
                {card.status === "awaiting_approval" && (
                  <div className="actions">
                    <button className="approve" onClick={approve} disabled={busy}>Approve {card.quote.total}</button>
                    <button className="reject" onClick={reject} disabled={busy}>Reject</button>
                  </div>
                )}
              </div>
            )}
          </section>

          {progress && (
            <section className="panel">
              <h3>Progress</h3>
              <ul className="steps">
                {steps.map((s, i) => {
                  const done = progress.at === 99 || i < progress.at || (i === progress.at && !!progress.hashes[s.key]);
                  const active = !done && i === progress.at && !progress.failed;
                  const failed = progress.failed && i === progress.at;
                  return (
                    <li key={s.key} className={done ? "done" : failed ? "fail" : active ? "active" : ""}>
                      <span className="dot" /> {s.label}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="panel proof">
            <h3>Proof</h3>
            {!result?.settlement && <div className="muted">Transaction hashes, explorer links and on-chain events appear here after you approve.</div>}
            {result?.settlement && (
              <>
                {result.settlement.simulatedChain && <div className="banner">SIMULATED CHAIN (offline mock rail). Hashes are not on any network.</div>}
                {result.settlement.proofs.map((p) => (
                  <div className="tx" key={p.txHash}>
                    <div className="muted">{p.step}</div>
                    {p.explorerUrl ? (
                      <a className="mono" href={p.explorerUrl} target="_blank" rel="noreferrer">{p.txHash}</a>
                    ) : (
                      <span className="mono">{p.txHash}</span>
                    )}
                  </div>
                ))}
                {result.settlement.events.map((e, i) => (
                  <div className="ev mono" key={i}>
                    <b>{e.name}</b> {Object.entries(e.args).map(([k, v]) => `${k}=${fmtArg(k, v)}`).join("  ")}
                  </div>
                ))}
                <div className="muted" style={{ marginTop: 8 }}>Paid to payout address <span className="mono">{short(result.settlement.payout)}</span></div>
              </>
            )}
          </section>

          {result?.payout && (
            <section className="panel">
              <h3>Recipient’s phone</h3>
              <div className="upi">
                <div className="ribbon">SIMULATED</div>
                <div className="tick">✓</div>
                <div className="amt">{result.payout.amountInr}</div>
                <div className="meta">credited via UPI to {result.payout.upiMasked}</div>
                <div className="meta mono" style={{ marginTop: 8 }}>{result.payout.reference}</div>
                <div className="meta" style={{ marginTop: 10, fontSize: 11 }}>{result.payout.note}</div>
              </div>
            </section>
          )}
        </div>
      </div>

      <section className="panel ap4m" style={{ marginTop: 18 }}>
        <h3>Autonomous micro-payments · Mastercard AP4M (live)</h3>
        <div className="muted" style={{ marginBottom: 10 }}>Small machine purchases run autonomously inside a funded cap. Sending money to family always waits for your tap.</div>
        <div className="ap4m-meta">
          <span>Team <b>{AP4M_PROOF.team}</b></span>
          <span>Agent <span className="mono" title={AP4M_PROOF.agent}>{addr(AP4M_PROOF.agent)}</span></span>
          <span>Merchant payout <span className="mono" title={AP4M_PROOF.merchantPayout}>{addr(AP4M_PROOF.merchantPayout)}</span></span>
          <span>Channel <span className="mono" title={AP4M_PROOF.channelId}>{`${AP4M_PROOF.channelId.slice(0, 10)}…${AP4M_PROOF.channelId.slice(-4)}`}</span> · cap <b>{AP4M_PROOF.channelCap}</b></span>
        </div>
        {AP4M_PROOF.purchases.map((p) => (
          <div className="ap4m-row" key={p.n}>
            <span className="ok">✓ Quote purchase #{p.n} · {p.amount}</span>
            <TxLink label="redeem" hash={p.redeemTx} />
            <TxLink label="payout" hash={p.payoutTx} />
            <TxLink label="settle" hash={p.settlementTx} />
            <a href={p.receiptUrl} target="_blank" rel="noreferrer">receipt</a>
          </div>
        ))}
        <div className="ap4m-row">
          <span className="bad">✕ {AP4M_PROOF.overCap.label}</span>
          <TxLink label="tx" hash={AP4M_PROOF.overCap.tx} />
        </div>
        <div className="ap4m-row">
          <span className="bad">✕ {AP4M_PROOF.killSwitch.label}</span>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <h3>Audit log · append-only audit.jsonl (newest first)</h3>
        <div className="tablewrap">
          <table className="audit">
            <thead>
              <tr><th>Time</th><th>Event</th><th>Rule</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {audit.map((e, i) => (
                <tr key={i}>
                  <td className="mono">{e.ts.slice(11, 19)}</td>
                  <td><span className={`tag ${e.event}`}>{e.event}</span></td>
                  <td className="mono">{e.rule}</td>
                  <td>
                    {e.txHash ? (
                      e.explorerUrl ? <a className="mono" href={e.explorerUrl} target="_blank" rel="noreferrer">{short(e.txHash)}</a> : <span className="mono">{short(e.txHash)}</span>
                    ) : (
                      e.reason
                    )}
                    {e.totalCents ? <span className="muted"> · ${(Number(e.totalCents) / 100).toFixed(2)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
