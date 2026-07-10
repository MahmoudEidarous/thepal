import { smPost, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";

type ForgetResult = { forgotten?: unknown[]; count?: number };

// Executes the forget the agent previewed. dryRun defaults to true so a
// bare call can never delete anything by accident.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return Response.json({ error: "query required" }, { status: 400 });
    }
    const res = await smPost<ForgetResult>("/v4/memories/forget-matching", {
      query,
      containerTag: spaceTag(asSpace(body.space)),
      dryRun: body.dryRun !== false,
      maxForget: 20,
    });
    return Response.json(res);
  } catch (err) {
    return apiError(err);
  }
}
