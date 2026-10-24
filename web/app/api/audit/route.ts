import { getAgent, json, setupError } from "@/lib/agent";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ events: getAgent().auditTail(40).reverse() });
  } catch (e) {
    return setupError(e);
  }
}
