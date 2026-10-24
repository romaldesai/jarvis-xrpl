// Server-only: one agent per server process. Keys stay in this process; the browser never sees them.
import "server-only";
import { createAgentFromEnv, type RemittanceAgent } from "@xrp2india/agent";

const g = globalThis as unknown as { __x2i?: RemittanceAgent; __x2iErr?: string };

export function getAgent(): RemittanceAgent {
  if (g.__x2i) return g.__x2i;
  try {
    g.__x2i = createAgentFromEnv();
    g.__x2iErr = undefined;
    return g.__x2i;
  } catch (e) {
    g.__x2iErr = e instanceof Error ? e.message : String(e);
    throw e;
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function setupError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return json({ setupError: msg, hint: "Run ./scripts/local-demo.sh --web for a local chain, or set SETTLEMENT_RAIL=mock for offline UI." }, 503);
}
