import { getAgent, json, setupError } from "@/lib/agent";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { id } = (await req.json().catch(() => ({}))) as { id?: unknown };
    if (typeof id !== "string") return json({ error: "bad id" }, 400);
    return json(getAgent().reject(id));
  } catch (e) {
    return setupError(e);
  }
}
