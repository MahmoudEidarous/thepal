import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      return Response.json({ error: "content required" }, { status: 400 });
    }
    const kind = ["memory", "decision", "commitment", "briefing"].includes(body.kind)
      ? (body.kind as string)
      : "memory";
    const doc = await supermemory.add({
      content,
      containerTag: spaceTag(asSpace(body.space)),
      metadata: {
        source: typeof body.source === "string" ? body.source : "recall-app",
        type: kind,
        ...(typeof body.due === "string" && body.due ? { due: body.due } : {}),
        ...(kind === "commitment" ? { status: "open" } : {}),
      },
    });
    return Response.json(doc);
  } catch (err) {
    return apiError(err);
  }
}
