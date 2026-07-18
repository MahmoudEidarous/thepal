export const KNOWLEDGE_ROUTER_VERSION = "knowledge-policy-v2-model-directed" as const;

export type KnowledgeRouteKind =
  | "model_directed"
  | "conversation"
  | "supplied_context"
  | "general_knowledge"
  | "structured_state"
  | "personal_memory"
  | "live_web"
  | "hybrid"
  | "clarify";

export type KnowledgeDomain =
  | "adaptive"
  | "social"
  | "current_turn"
  | "general"
  | "agenda"
  | "threads"
  | "continuity"
  | "prospective"
  | "briefing"
  | "emotional_history"
  | "story"
  | "profile"
  | "personal_history"
  | "weather"
  | "world"
  | "hybrid"
  | "state_change"
  | "ambiguous";

export type KnowledgeRetrievalTool =
  | "search_memories"
  | "get_profile"
  | "get_agenda"
  | "get_life_threads"
  | "get_continuity"
  | "get_prospective_memories"
  | "get_briefing"
  | "get_emotional_weather"
  | "get_weather"
  | "search_web"
  | "show_story"
  | "resolve_hybrid_context";

export const MODEL_DIRECTED_RETRIEVAL_TOOLS: KnowledgeRetrievalTool[] = [
  "search_memories",
  "get_profile",
  "get_agenda",
  "get_life_threads",
  "get_continuity",
  "get_prospective_memories",
  "get_briefing",
  "get_emotional_weather",
  "get_weather",
  "search_web",
  "show_story",
  "resolve_hybrid_context",
];

export type KnowledgeCoverage = {
  selectedMemory: boolean;
  canonicalItems: number;
  threadItems: number;
  structuredItems: number;
  historicalItems: number;
  continuityItems: number;
  semanticHistoryChecked: boolean;
  commitmentsChecked: boolean;
  prospectiveChecked: boolean;
  degradedSources: string[];
};

export type KnowledgeRoute = {
  contractVersion: 1;
  routerVersion: typeof KNOWLEDGE_ROUTER_VERSION;
  kind: KnowledgeRouteKind;
  domain: KnowledgeDomain;
  evidenceRequired: boolean;
  freshnessRequired: boolean;
  requiresEpisodicEvidence: boolean;
  requiredSources: Array<
    | "current_turn"
    | "supplied_context"
    | "structured_state"
    | "personal_memory"
    | "model_knowledge"
    | "live_web"
    | "clarification"
  >;
  allowedRetrievalTools: KnowledgeRetrievalTool[];
  reason: string;
  coverage: KnowledgeCoverage;
};

export type KnowledgeRouteInput = {
  query: string;
  recentTurns?: Array<{ role: "user" | "agent"; text: string }>;
  selectedMemory?: string | null;
  coverage?: Partial<KnowledgeCoverage>;
};

const EMPTY_COVERAGE: KnowledgeCoverage = {
  selectedMemory: false,
  canonicalItems: 0,
  threadItems: 0,
  structuredItems: 0,
  historicalItems: 0,
  continuityItems: 0,
  semanticHistoryChecked: false,
  commitmentsChecked: false,
  prospectiveChecked: false,
  degradedSources: [],
};

/**
 * This used to classify each sentence with regular expressions and then block
 * every retrieval tool outside the chosen class. That made wording bugs into
 * hard failures. Source selection now belongs to the conversational model.
 *
 * The manifest remains useful for observability and for telling the client
 * which read-only capabilities are in bounds. It is deliberately identical
 * for every wording, so it cannot overrule the model's understanding.
 */
export function routeKnowledgeTurn(input: KnowledgeRouteInput): KnowledgeRoute {
  const coverage: KnowledgeCoverage = {
    ...EMPTY_COVERAGE,
    ...input.coverage,
    selectedMemory: input.coverage?.selectedMemory ?? !!input.selectedMemory,
    degradedSources: [...new Set(input.coverage?.degradedSources ?? [])],
  };

  return {
    contractVersion: 1,
    routerVersion: KNOWLEDGE_ROUTER_VERSION,
    kind: "model_directed",
    domain: "adaptive",
    evidenceRequired: false,
    freshnessRequired: false,
    requiresEpisodicEvidence: false,
    requiredSources: ["current_turn"],
    allowedRetrievalTools: [...MODEL_DIRECTED_RETRIEVAL_TOOLS],
    reason:
      "The conversational model chooses no source, one source, or several independent sources from meaning and context.",
    coverage,
  };
}

export function knowledgeToolAllowed(
  decision: KnowledgeRoute,
  tool: KnowledgeRetrievalTool,
) {
  return decision.allowedRetrievalTools.includes(tool);
}

export function formatKnowledgeRoute(decision: KnowledgeRoute) {
  const supplied = [
    decision.coverage.canonicalItems ? `${decision.coverage.canonicalItems} canonical` : "",
    decision.coverage.threadItems ? `${decision.coverage.threadItems} threads` : "",
    decision.coverage.structuredItems ? `${decision.coverage.structuredItems} structured` : "",
    decision.coverage.historicalItems ? `${decision.coverage.historicalItems} episodes` : "",
    decision.coverage.selectedMemory ? "selected memory" : "",
  ].filter(Boolean);

  return [
    `RECALL SOURCE POLICY ${decision.routerVersion}`,
    "Decision: the conversational model owns source selection for this turn.",
    `Already supplied: ${supplied.length ? supplied.join(", ") : "current conversation and continuity kernel"}`,
    "Use zero tools for ordinary conversation, reasoning, stable knowledge, or facts already present.",
    "Use the narrowest authoritative tool when unavailable evidence is necessary. Use multiple tools when distinct parts of the question genuinely require different authorities.",
    "Earlier private life belongs to Recall memory; exact ledgers and projections belong to their structured tools; changing external facts belong to live-world tools.",
    "Never send private personal details to web search. Never use web results as evidence of the user's life. Never replace current external truth with an old memory or training-era guess.",
    "Do not duplicate a lookup whose answer is already supplied. If evidence is absent after a justified lookup, say so honestly.",
    "This policy is internal. Never mention sources, routes, tools, gates, or manifests to the user.",
  ].join("\n");
}
