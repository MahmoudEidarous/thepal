import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      return Response.json({ error: "content required" }, { status: 400 });
    }
    const doc = await supermemory.add({
      content,
      containerTag: spaceTag(asSpace(body.space)),
      metadata: { source: "recall-app" },
    });
    return Response.json(doc);
  } catch (err) {
    return apiError(err);
  }
}
