import { spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { pinned } from "@/lib/ledger";

// SAFETY and boundaries, pinned. These ride into every voice session
// as dynamic variables at connect — a wrong suggestion can't happen
// because retrieval never gets a vote.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tag = spaceTag(asSpace(url.searchParams.get("space")));
    return Response.json({ pinned: await pinned(tag) });
  } catch (err) {
    return apiError(err);
  }
}
