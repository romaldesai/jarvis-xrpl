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
  return json(await a.prepare(text));
}
