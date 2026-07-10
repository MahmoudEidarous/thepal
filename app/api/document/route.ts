import { supermemory } from "@/lib/supermemory";
import { apiError } from "@/lib/validate";

// Full document by id — the captures view expands with this (the
// stored content carries the embedded phrasing hints).
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return Response.json({ error: "id required" }, { status: 400 });
    }
    const doc = (await supermemory.documents.get(id)) as {
      content?: string | null;
      metadata?: Record<string, unknown> | null;
      createdAt?: string;
    };
    return Response.json({
      content: doc.content ?? "",
      metadata: doc.metadata ?? {},
      createdAt: doc.createdAt,
    });
  } catch (err) {
    return apiError(err);
  }
}

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
