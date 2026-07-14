import {
  LIFE_THREAD_KINDS,
  LIFE_THREAD_STATUSES,
  type LifeThreadKind,
  type LifeThreadStatus,
} from "@/lib/memory/contracts";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { rebuildThreads } from "@/lib/memory/thread-engine";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

const STATUSES = new Set<string>(LIFE_THREAD_STATUSES);
const KINDS = new Set<string>(LIFE_THREAD_KINDS);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const status = url.searchParams.get("status");
    const kind = url.searchParams.get("kind");
    if (status && !STATUSES.has(status)) {
      return Response.json({ error: "invalid life-thread status" }, { status: 400 });
    }
    if (kind && !KINDS.has(kind)) {
      return Response.json({ error: "invalid life-thread kind" }, { status: 400 });
    }

    const ledger = getMemoryEventLedger();
    // Rebuilding is deterministic and local. Doing it on reads applies
    // time-based dormancy even during periods with no new capture, and also
    // materializes existing schema-v2 memories after the v3 migration.
    rebuildThreads(ledger, "local-user", space);
    const threads = ledger.listThreads({
      userId: "local-user",
      space,
      id: url.searchParams.get("id") ?? undefined,
      status: (status as LifeThreadStatus | null) ?? undefined,
      kind: (kind as LifeThreadKind | null) ?? undefined,
      activeOnly: url.searchParams.get("active") === "true",
      limit: Number(url.searchParams.get("limit") ?? 100),
    });
    const includeTransitions = url.searchParams.get("transitions") === "true";
    return Response.json({
      space,
      count: threads.length,
      threads,
      transitions: includeTransitions
        ? ledger.listThreadTransitions({
            userId: "local-user",
            space,
            threadId: threads.length === 1 ? threads[0].id : undefined,
            limit: Number(url.searchParams.get("transitionLimit") ?? 500),
          })
        : undefined,
    });
  } catch (error) {
    return apiError(error);
  }
}
