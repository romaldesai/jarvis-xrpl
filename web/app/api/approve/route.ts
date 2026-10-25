import { getAgent, setupError } from "@/lib/agent";
export const runtime = "nodejs";

// Streams NDJSON: {"step":...} lines while the rail works, then {"result":...}.
export async function POST(req: Request) {
  let a;
  try {
    a = getAgent();
  } catch (e) {
    return setupError(e);
  }
  const { id } = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof id !== "string") return new Response("bad id", { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (o: unknown) => ctl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const result = await a.approve(id, (step, d) => send({ step, ...(d ?? {}) }));
      send({ result });
      ctl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
