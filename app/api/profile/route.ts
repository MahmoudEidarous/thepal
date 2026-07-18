import { supermemory, spaceTag } from "@/lib/supermemory";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { currentUserIdentityName } from "@/lib/memory/identity";
import { apiError, asSpace } from "@/lib/validate";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? undefined;
    const space = asSpace(url.searchParams.get("space"));
    const profile = await supermemory.profile({
      containerTag: spaceTag(space),
      ...(q ? { q } : {}),
    });
    const identityName = currentUserIdentityName(getMemoryEventLedger(), "local-user", space);
    if (!identityName || !profile.profile) return Response.json(profile);
    const nameLine = `The user's name is ${identityName.name}.`;
    return Response.json({
      ...profile,
      profile: {
        ...profile.profile,
        static: [
          nameLine,
          ...profile.profile.static.filter(
            (item) => !/^the user(?:'s|’s) name is\b/i.test(item),
          ),
        ],
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
