import { getAgent, json, setupError } from "@/lib/agent";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let a;
  try {
    a = getAgent();
  } catch (e) {
    return setupError(e);
  }
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.slice(0, 500) : "";
  if (!text.trim()) return json({ error: "empty message" }, 400);
  try {
    return json(await a.prepare(text));
  } catch (e) {
    // Fail closed with a readable message (nothing was prepared, nothing moved).
    return json({ error: `Could not prepare payment: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` }, 500);
  }
}
