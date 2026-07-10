import { supermemory } from "@/lib/supermemory";
import { apiError } from "@/lib/validate";

// Dismiss a document (e.g. a failed capture) from the feed.
export async function DELETE(request: Request) {
  try {
    const { id } = await request.json().catch(() => ({}));
    if (typeof id !== "string" || !id) {
      return Response.json({ error: "id required" }, { status: 400 });
    }
    await supermemory.documents.delete(id);
    return Response.json({ deleted: true });
  } catch (err) {
    return apiError(err);
  }
}
