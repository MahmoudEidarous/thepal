import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";

// Feed for the live memory panel: recent documents with processing status.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const docs = await supermemory.documents.list({
      containerTags: [spaceTag(asSpace(url.searchParams.get("space")))],
      limit: 30,
      sort: "createdAt",
      order: "desc",
    });
    return Response.json(docs);
  } catch (err) {
    return apiError(err);
  }
}
