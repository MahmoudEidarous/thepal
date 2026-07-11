import { apiError, asSpace } from "@/lib/validate";
import { storyRecall } from "@/lib/fusion";

// Story mode's script supplier: one topic in, ordered chapters out.
// The same fused read path that answers questions picks the beats;
// story-dates arrange them in the order they were lived.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    if (!topic) {
      return Response.json({ error: "topic required" }, { status: 400 });
    }
    const beats = await storyRecall({ q: topic, space: asSpace(body.space), limit: 8 });
    return Response.json({ topic, beats });
  } catch (err) {
    return apiError(err);
  }
}
