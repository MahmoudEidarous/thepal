import { buildDossier } from "@/lib/memory/continuity-projectors";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const about = url.searchParams.get("about")?.trim().slice(0, 120) ?? "";
    if (!about) return Response.json({ error: "about is required" }, { status: 400 });
    const space = asSpace(url.searchParams.get("space"));
    const dossier = buildDossier(getMemoryEventLedger(), "local-user", space, about);
    return dossier
      ? Response.json({ dossier })
      : Response.json({ dossier: null, message: `No grounded dossier matches “${about}”.` });
  } catch (error) {
    return apiError(error);
  }
}
