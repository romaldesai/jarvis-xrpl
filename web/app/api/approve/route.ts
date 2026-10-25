import { getAgent, setupError } from "@/lib/agent";
export const runtime = "nodejs";

// Streams NDJSON: {"step":...} lines while the rail works, then exactly one {"result":...} line.
// Any unexpected error still ends the stream with a {"result":{ok:false}} line, so the UI never hangs.
export async function POST(req: Request) {
  let a;
  try {
    a = getAgent();
  } catch (e) {
    return setupError(e);
  }
  const { id } = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof id !== "string") return new Response(JSON.stringify({ error: "bad id" }) + "\n", { status: 400, headers: { "content-type": "application/json" } });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (o: unknown) => {
        try {
          ctl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          // client went away; keep going so the settlement result is still audited server-side
        }
      };
      try {
        const result = await a.approve(id, (step, d) => send({ step, ...(d ?? {}) }));
        send({ result });
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        send({ result: { ok: false, id, rule: "SERVER_ERROR", error: msg } });
      } finally {
        try {
          ctl.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
