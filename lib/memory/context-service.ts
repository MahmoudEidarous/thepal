import { fusedRecall, type Hit } from "../fusion";
import { openCommitments, pinned, type OpenCommitment } from "../ledger";
import {
  matchProspectiveCandidates,
  matchProspectiveTrigger,
  type ProspectiveMatch,
} from "../prospective";
import { spaceTag } from "../supermemory";
import {
  compileContext,
  type CompileContextInput,
  type HistoricalCandidate,
} from "./context-compiler";
import type { MemoryEvent } from "./contracts";
import { getMemoryEventLedger, type MemoryEventLedger } from "./event-ledger";
import { rebuildThreads } from "./thread-engine";
import { rebuildProspective } from "./prospective-projector";
import { continuityContextViews } from "./continuity-projectors";

export type ContextCompilerDependencies = {
  ledger?: MemoryEventLedger;
  getPins?: typeof pinned;
  getCommitments?: typeof openCommitments;
  matchProspective?: typeof matchProspectiveTrigger;
  recall?: typeof fusedRecall;
};

export async function compileMemoryContext(
  input: CompileContextInput & {
    seenProspective?: string[];
    includeHistory?: boolean;
    includePins?: boolean;
    includeProspective?: boolean;
    includeObligations?: boolean;
  },
  dependencies: ContextCompilerDependencies = {},
) {
  const ledger = dependencies.ledger ?? getMemoryEventLedger();
  const userId = input.userId ?? "local-user";
  const at = input.at ?? new Date().toISOString();
  const tag = spaceTag(input.space);
  rebuildThreads(ledger, userId, input.space, { asOf: at });
  rebuildProspective(ledger, userId, input.space);
  const events = ledger.listActiveEvents(userId, input.space);
  const claimEvidence = ledger.listClaimEvidence(userId, input.space);
  const beliefs = [
    ...ledger.listBeliefs({ userId, space: input.space, status: "current", limit: 1_000 }),
    ...ledger.listBeliefs({ userId, space: input.space, status: "conflicting", limit: 1_000 }),
  ];
  const threads = ledger.listThreads({ userId, space: input.space, activeOnly: true, limit: 500 });
  const degradedSources: string[] = [];
  const safe = async <T>(name: string, fallback: T, operation: () => Promise<T>) => {
    try {
      return await operation();
    } catch {
      degradedSources.push(name);
      return fallback;
    }
  };
  const query = input.query
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
  const continuityViews = query
    ? continuityContextViews(ledger, userId, input.space, query, at)
    : [];
  const [pins, commitments, prospective, rawHistory] = await Promise.all([
    input.includePins === false
      ? Promise.resolve([] as string[])
      : safe("pinned memory", [] as string[], () => (dependencies.getPins ?? pinned)(tag)),
    input.includeObligations === false
      ? Promise.resolve([] as OpenCommitment[])
      : safe("commitment ledger", [] as OpenCommitment[], () =>
          (dependencies.getCommitments ?? openCommitments)(tag)),
    input.includeProspective === false || !query
      ? Promise.resolve([] as ProspectiveMatch[])
      : safe("prospective memory", [] as ProspectiveMatch[], async () => {
          const match = dependencies.matchProspective
            ? await dependencies.matchProspective({
                tag,
                context: query,
                seen: input.seenProspective ?? [],
              })
            : matchProspectiveCandidates(
                ledger.listProspective({ userId, space: input.space }),
                query,
                input.seenProspective ?? [],
              );
          return match ? [match] : [];
        }),
    input.includeHistory === false || query.length < 3
      ? Promise.resolve([] as Hit[])
      : safe("semantic history", [] as Hit[], () =>
          (dependencies.recall ?? fusedRecall)({
            q: query,
            space: input.space,
            limit: 10,
            excludeUnlisted: true,
          })),
  ]);
  const eventByDocument = new Map<string, MemoryEvent>();
  for (const event of events) {
    const mirror = ledger.getMirror(event.id);
    if (mirror?.status === "synced") eventByDocument.set(mirror.externalId, event);
  }
  const history: HistoricalCandidate[] = rawHistory.map((hit) => {
    const event = eventByDocument.get(hit.documentId);
    return {
      ...hit,
      trust: event?.source.trust ?? null,
      sensitivity: event?.sensitivity ?? "normal",
      evidenceEventIds: event ? [event.id] : [],
    };
  });
  return compileContext(
    { ...input, at, query },
    {
      pins,
      beliefs,
      threads,
      commitments,
      prospective,
      history,
      events,
      claimEvidence,
      continuityViews,
      degradedSources,
    },
  );
}
