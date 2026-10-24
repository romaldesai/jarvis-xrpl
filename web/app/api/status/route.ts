import { getAgent, json, setupError } from "@/lib/agent";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const a = getAgent();
    return json({ rail: a.rail.info(), killed: a.killed(), budget: await a.budget(), llm: !!(a.cfg.llm.apiKey && a.cfg.llm.model) });
  } catch (e) {
    return setupError(e);
  }
}
