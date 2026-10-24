// Intent parsing. The LLM (optional) and the regex parser both produce the SAME untrusted shape;
// the policy engine validates it. The LLM never sees keys and never builds transactions.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { parseDecimal } from "./money";

export type Currency = "INR" | "USD";

export interface Intent {
  currency: Currency;
  /** INR: paise. USD: cents. */
  amountMinor: bigint;
  /** Canonical alias if recognised, else the raw word the user used (policy will reject it). */
  recipient: string | null;
  source: "llm" | "regex";
  text: string;
}

const SYNONYMS: Record<string, string> = {
  mother: "mother", mom: "mother", mommy: "mother", mum: "mother", ma: "mother", maa: "mother", mummy: "mother", amma: "mother", aai: "mother",
  father: "father", dad: "father", papa: "father", pappa: "father", baba: "father",
  brother: "brother", bro: "brother", bhai: "brother",
  sister: "sister", sis: "sister", didi: "sister", behen: "sister",
};

export function canonicalRecipient(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  return SYNONYMS[w] ?? w;
}

const INR_RE = /(?:₹|\brs\.?|\binr\b)\s*([\d,]+(?:\.\d+)?)\s*(k|lakh|lakhs|lac)?|([\d,]+(?:\.\d+)?)\s*(k|lakh|lakhs|lac)?\s*(?:rupees|rs\b|inr\b)/i;
const USD_RE = /(?:\$|\busd\b)\s*([\d,]+(?:\.\d+)?)\s*(k)?|([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:dollars|usd\b|bucks)/i;
const TO_RE = /\bto\s+(?:my\s+|our\s+)?([a-z]+)/i;

function scale(v: bigint, mult?: string): bigint {
  if (!mult) return v;
  const m = mult.toLowerCase();
  if (m === "k") return v * 1000n;
  return v * 100_000n; // lakh
}

/** Deterministic parser: the demo never depends on the LLM. Returns null if no amount found. */
export function parseIntentRegex(text: string): Intent | null {
  const inr = INR_RE.exec(text);
  const usd = USD_RE.exec(text);
  let currency: Currency;
  let minor: bigint;
  try {
    if (inr && (!usd || inr.index <= usd.index)) {
      currency = "INR";
      minor = scale(parseDecimal(inr[1] ?? inr[3], 2), inr[2] ?? inr[4]);
    } else if (usd) {
      currency = "USD";
      minor = scale(parseDecimal(usd[1] ?? usd[3], 2), usd[2] ?? usd[4]);
    } else return null;
  } catch {
    return null;
  }
  const to = TO_RE.exec(text);
  return { currency, amountMinor: minor, recipient: to ? canonicalRecipient(to[1]) : null, source: "regex", text };
}

const LlmIntent = z.object({
  is_payment: z.boolean(),
  currency: z.enum(["INR", "USD"]),
  amount: z.string().describe("Plain decimal number, no symbols or commas, e.g. 5000 or 49.99"),
  recipient: z.string().describe("Who receives it, as a relationship word in English, e.g. mother, brother"),
});

const SYSTEM = `You extract a remittance intent from one chat message. You only extract; you never decide whether it is allowed.
Return is_payment=false if the message is not a request to send money. Convert "5k" to 5000 and "1 lakh" to 100000.
Map family words in any language to an English relationship word (maa, amma -> mother; bhai -> brother).`;

/** LLM parser via structured outputs. Short timeout, no retries; any failure returns null (caller falls back). */
export async function parseIntentLLM(text: string, opts: { apiKey: string; model: string; timeoutMs: number }): Promise<Intent | null> {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 0 });
  try {
    const res = await client.messages.parse({
      model: opts.model,
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(LlmIntent) },
      messages: [{ role: "user", content: text.slice(0, 500) }],
    });
    if (res.stop_reason === "refusal") return null;
    const out = res.parsed_output;
    if (!out || !out.is_payment) return null;
    return {
      currency: out.currency,
      amountMinor: parseDecimal(out.amount, 2),
      recipient: canonicalRecipient(out.recipient),
      source: "llm",
      text,
    };
  } catch {
    return null;
  }
}

/** LLM first (if configured), deterministic regex fallback. */
export async function parseIntent(text: string, llm: { apiKey: string | null; model: string | null; timeoutMs: number }): Promise<Intent | null> {
  if (llm.apiKey && llm.model) {
    const r = await parseIntentLLM(text, { apiKey: llm.apiKey, model: llm.model, timeoutMs: llm.timeoutMs });
    if (r) return r;
  }
  return parseIntentRegex(text);
}
