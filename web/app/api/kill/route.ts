import { getAgent, json, setupError } from "@/lib/agent";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { on } = (await req.json().catch(() => ({}))) as { on?: unknown };
    return json(getAgent().setKill(on === true));
  } catch (e) {
    return setupError(e);
  }
}
