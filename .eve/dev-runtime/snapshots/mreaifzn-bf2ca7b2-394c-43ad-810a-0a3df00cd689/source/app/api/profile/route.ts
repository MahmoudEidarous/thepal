import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? undefined;
    const profile = await supermemory.profile({
      containerTag: spaceTag(asSpace(url.searchParams.get("space"))),
      ...(q ? { q } : {}),
    });
    return Response.json(profile);
  } catch (err) {
    return apiError(err);
  }
}
