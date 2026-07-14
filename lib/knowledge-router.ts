export const KNOWLEDGE_ROUTER_VERSION = "knowledge-router-v1" as const;

export type KnowledgeRouteKind =
  | "conversation"
  | "supplied_context"
  | "general_knowledge"
  | "structured_state"
  | "personal_memory"
  | "live_web"
  | "hybrid"
  | "clarify";

export type KnowledgeDomain =
  | "social"
  | "current_turn"
  | "general"
  | "agenda"
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
  | "get_prospective_memories"
  | "get_briefing"
  | "get_emotional_weather"
  | "get_weather"
  | "search_web"
  | "show_story"
  | "resolve_hybrid_context";

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

function clean(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

function has(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function route(
  kind: KnowledgeRouteKind,
  domain: KnowledgeDomain,
  reason: string,
  options: Partial<Pick<
    KnowledgeRoute,
    | "evidenceRequired"
    | "freshnessRequired"
    | "requiresEpisodicEvidence"
    | "requiredSources"
    | "allowedRetrievalTools"
  >> = {},
): Omit<KnowledgeRoute, "coverage"> {
  return {
    contractVersion: 1,
    routerVersion: KNOWLEDGE_ROUTER_VERSION,
    kind,
    domain,
    evidenceRequired: options.evidenceRequired ?? false,
    freshnessRequired: options.freshnessRequired ?? false,
    requiresEpisodicEvidence: options.requiresEpisodicEvidence ?? false,
    requiredSources: options.requiredSources ?? ["current_turn"],
    allowedRetrievalTools: options.allowedRetrievalTools ?? [],
    reason,
  };
}

function baseRoute(input: KnowledgeRouteInput): Omit<KnowledgeRoute, "coverage"> {
  const original = clean(input.query);
  const text = original.toLowerCase();
  const hasRecentContext = (input.recentTurns?.length ?? 0) > 1 || !!input.selectedMemory;
  if (!text) {
    return route("conversation", "social", "No factual request is present; remain conversational.");
  }

  const explicitStateChange = has(
    text,
    /\b(remember (?:that|this)|save (?:that|this)|forget (?:that|this|everything)|next time .+ remind me|when i mention .+ remind me|cancel (?:that|the) reminder|snooze (?:that|the) reminder|mark .+ (?:done|complete)|i (?:did|finished|completed) it)\b/,
  );
  if (explicitStateChange) {
    return route(
      "conversation",
      "state_change",
      "The user requested a state change, not factual retrieval; use the matching write/lifecycle tool only.",
    );
  }

  const vagueReference = has(
    text,
    /^(?:what about (?:that|this|it)|is (?:that|this|it) good|did (?:that|this|it) happen|look it up|check that|and (?:him|her|that|this))\??$/,
  );
  if (vagueReference && !hasRecentContext) {
    return route("clarify", "ambiguous", "The referent is unavailable; ask one natural clarification.", {
      evidenceRequired: true,
      requiredSources: ["clarification"],
    });
  }
  if (vagueReference && hasRecentContext) {
    return route(
      "conversation",
      "current_turn",
      "The referent is already available in the active conversation; do not retrieve it again.",
    );
  }

  const asksAgenda = has(
    text,
    /\b(what do i owe|what(?:'s| is) (?:on )?my (?:agenda|plate|list)|open commitments?|commitments? (?:do i|are)|what is due|what(?:'s| is) due|deadlines?|to-?do(?:s)?|things i need to do)\b/,
  );
  if (asksAgenda) {
    return route("structured_state", "agenda", "The commitment ledger is the exact authority.", {
      evidenceRequired: true,
      requiredSources: ["structured_state"],
      allowedRetrievalTools: ["get_agenda"],
    });
  }

  const asksProspective = has(
    text,
    /\b(what (?:were|are) you (?:going|supposed) to remind me|future reminders?|prospective memor(?:y|ies)|waiting to remind me|next-time reminders?|reminders? (?:are )?waiting)\b/,
  );
  if (asksProspective) {
    return route(
      "structured_state",
      "prospective",
      "The prospective-memory ledger is the exact authority.",
      {
        evidenceRequired: true,
        requiredSources: ["structured_state"],
        allowedRetrievalTools: ["get_prospective_memories"],
      },
    );
  }

  if (has(text, /\b(briefing|what did you dream|dream report|catch me up from the briefing)\b/)) {
    return route("structured_state", "briefing", "The generated briefing is the requested artifact.", {
      evidenceRequired: true,
      requiredSources: ["structured_state"],
      allowedRetrievalTools: ["get_briefing"],
    });
  }

  if (
    has(
      text,
      /\b(how have i been feeling|emotional weather|emotional arc|mood (?:this|last) (?:week|month)|emotionally lately|roughest day|brightest day)\b/,
    )
  ) {
    return route(
      "personal_memory",
      "emotional_history",
      "The answer requires the user's grounded emotional history.",
      {
        evidenceRequired: true,
        requiresEpisodicEvidence: true,
        requiredSources: ["personal_memory"],
        allowedRetrievalTools: ["get_emotional_weather", "search_memories"],
      },
    );
  }

  if (
    has(
      text,
      /\b(take me through|tell me the story of|show me the story of|how did .+ happen|walk me through my|show me my (?:week|month|year))\b/,
    )
  ) {
    return route("personal_memory", "story", "The user asked for an episodic memory tour.", {
      evidenceRequired: true,
      requiresEpisodicEvidence: true,
      requiredSources: ["personal_memory"],
      allowedRetrievalTools: ["show_story", "search_memories"],
    });
  }

  const asksProfile = has(
    text,
    /\b(what do you know about me|who am i|describe me|my profile|what are my preferences|what do i (?:like|love|hate|prefer)|what(?:'s| is) my favorite)\b/,
  );

  const explicitMemory = has(
    text,
    /\b(do you remember|remember when|search (?:your|my|our) memor(?:y|ies)|look (?:in|through) (?:your|my|our) memor(?:y|ies)|did i (?:ever )?tell you|what did i (?:say|tell you)|have i ever|when did i|where did i|who did i|last time i|what happened with my|what happened to my)\b/,
  );
  const personalPattern = has(
    text,
    /\b(?:why|do|am|have|what|when|where|who) (?:i|me|my)\b.*\b(always|usually|normally|tend to|used to|favorite|prefer|like|hate|pattern|habit)\b|\b(always|usually|normally|tend to|used to)\b.*\b(i|me|my)\b/,
  );
  const personalHistory = explicitMemory || personalPattern || asksProfile;
  const personalContext =
    personalHistory ||
    has(
      text,
      /\b(?:given|based on|considering)\b.*\b(?:what i told you|what you remember|my (?:history|situation|routine|usual|knee|sleep|insomnia))\b|\bmy usual\b/,
    );

  const explicitOnline = has(
    text,
    /\b(search (?:the )?(?:web|internet|online)|look (?:(?:it|this|that) )?up(?: online)?|google it|check online|find (?:it|that) online|give me sources?|cite (?:it|that|your sources?))\b/,
  );
  const asksWeather = has(
    text,
    /\b(weather|forecast|temperature|will it rain|is it raining|how hot|how cold|the sky (?:today|tomorrow))\b/,
  );
  const changingWorld = has(
    text,
    /\b(latest|breaking|news|right now|currently|current (?:studies|research|advice|guidance|version|ceo|president)|today(?:'s)?|tomorrow(?:'s)?|this (?:morning|afternoon|evening|week)|price|cost today|score|result|standings?|stock|market|exchange rate|open now|opening hours?|availability|in stock|traffic|delay|cancelled|schedule|release date|released yet|shipped yet|election|live)\b/,
  );
  const highStakes = has(
    text,
    /\b(diagnos|symptom|medication|dose|dosage|legal advice|laws? (?:in|about)|tax|investment|financial advice|visa requirements?|immigration requirements?)\b/,
  );
  const externalQuestion = has(text, /\b(what|when|where|who|which|is|are|did|does|has|how)\b/);
  const needsLiveWorld = explicitOnline || asksWeather || highStakes || (changingWorld && externalQuestion);

  if (personalContext && needsLiveWorld) {
    return route("hybrid", "hybrid", "The answer needs both private history and current external truth.", {
      evidenceRequired: true,
      freshnessRequired: true,
      requiresEpisodicEvidence: explicitMemory,
      requiredSources: ["personal_memory", "live_web"],
      allowedRetrievalTools: ["resolve_hybrid_context"],
    });
  }

  if (asksWeather) {
    return route("live_web", "weather", "Weather is current external state.", {
      evidenceRequired: true,
      freshnessRequired: true,
      requiredSources: ["live_web"],
      allowedRetrievalTools: ["get_weather"],
    });
  }

  if (needsLiveWorld) {
    return route(
      "live_web",
      "world",
      highStakes
        ? "The answer requires current authoritative verification."
        : "The requested world fact may have changed and requires live retrieval.",
      {
        evidenceRequired: true,
        freshnessRequired: true,
        requiredSources: ["live_web"],
        allowedRetrievalTools: ["search_web"],
      },
    );
  }

  if (asksProfile) {
    return route("personal_memory", "profile", "The answer is private user-specific truth.", {
      evidenceRequired: true,
      requiredSources: ["personal_memory"],
      allowedRetrievalTools: ["get_profile", "search_memories"],
    });
  }

  if (explicitMemory || personalPattern) {
    return route(
      "personal_memory",
      "personal_history",
      "The answer requires evidence from the user's earlier life.",
      {
        evidenceRequired: true,
        requiresEpisodicEvidence: explicitMemory,
        requiredSources: ["personal_memory"],
        allowedRetrievalTools: ["search_memories"],
      },
    );
  }

  const currentReference = has(
    text,
    /\b(what do you think (?:about )?(?:that|this|it)|does that make sense|should i do that|why would (?:that|this) happen|and then what|what about him|what about her)\b/,
  );
  if (currentReference && hasRecentContext) {
    return route(
      "conversation",
      "current_turn",
      "The active conversation already contains the needed referent.",
    );
  }

  const socialOrAdvice = has(
    text,
    /^(?:hey|hi|hello|yo|thanks|thank you|good morning|good night|lol|haha|that(?:'s| is) (?:absolutely )?(?:funny|wild|crazy|great|awful)|i feel |i(?:'m| am) |i think |do you think |what do you think |should i |would you |help me (?:choose|decide|think|brainstorm)|tell me a joke|make me laugh|talk to me|keep me company)/,
  );
  if (socialOrAdvice || !externalQuestion) {
    return route(
      "conversation",
      "social",
      "This is social conversation, current emotion, opinion, or reasoning; retrieval would make it slower and less human.",
    );
  }

  return route(
    "general_knowledge",
    "general",
    "The question is stable general knowledge and does not require personal or current external evidence.",
    {
      requiredSources: ["model_knowledge"],
    },
  );
}

function refineWithCoverage(
  initial: Omit<KnowledgeRoute, "coverage">,
  coverage: KnowledgeCoverage,
): Omit<KnowledgeRoute, "coverage"> {
  const canonicalAvailable =
    coverage.selectedMemory ||
    coverage.canonicalItems > 0 ||
    coverage.threadItems > 0 ||
    coverage.continuityItems > 0 ||
    coverage.historicalItems > 0;
  const personalCoverageComplete = initial.requiresEpisodicEvidence
    ? coverage.historicalItems > 0 || coverage.semanticHistoryChecked
    : canonicalAvailable;

  if (initial.kind === "personal_memory" && personalCoverageComplete) {
    return route(
      "supplied_context",
      initial.domain,
      coverage.historicalItems > 0
        ? "Relevant personal evidence is already inside the supplied context packet."
        : coverage.semanticHistoryChecked
          ? "Personal memory was already searched for this turn; use the supplied result or its honest miss."
          : "Relevant canonical truth is already inside the supplied context packet.",
      {
        evidenceRequired: initial.evidenceRequired,
        freshnessRequired: initial.freshnessRequired,
        requiresEpisodicEvidence: initial.requiresEpisodicEvidence,
        requiredSources: ["supplied_context"],
      },
    );
  }

  if (initial.kind === "hybrid" && canonicalAvailable) {
    return {
      ...initial,
      reason: "The personal side is already supplied; only current external truth still requires retrieval.",
      requiredSources: ["supplied_context", "live_web"],
      allowedRetrievalTools: initial.domain === "weather" ? ["get_weather"] : ["search_web"],
    };
  }

  return initial;
}

export function routeKnowledgeTurn(input: KnowledgeRouteInput): KnowledgeRoute {
  const coverage: KnowledgeCoverage = {
    ...EMPTY_COVERAGE,
    ...input.coverage,
    selectedMemory: input.coverage?.selectedMemory ?? !!input.selectedMemory,
    degradedSources: [...new Set(input.coverage?.degradedSources ?? [])],
  };
  return {
    ...refineWithCoverage(baseRoute(input), coverage),
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
    `RECALL KNOWLEDGE ROUTE ${decision.routerVersion}`,
    `Decision: ${decision.kind} · ${decision.domain}`,
    `Why: ${decision.reason}`,
    `Already supplied: ${supplied.length ? supplied.join(", ") : "current turn only"}`,
    `Allowed retrieval: ${decision.allowedRetrievalTools.length ? decision.allowedRetrievalTools.join(", ") : "none"}`,
    decision.kind === "conversation"
      ? "Action: answer naturally now from the current conversation, personality, and reasoning. Do not call a retrieval tool."
      : decision.kind === "general_knowledge"
        ? "Action: answer from stable model knowledge. Do not retrieve unless the user asks for current verification."
        : decision.kind === "supplied_context"
          ? "Action: the needed evidence is already in the newest context packet. Answer from it without searching again."
          : decision.kind === "clarify"
            ? "Action: ask one natural clarification; do not guess or retrieve an unresolved referent."
            : "Action: use only the allowed retrieval source, once. Never substitute a different authority.",
    "This routing block is internal policy. Never mention routes, tools, manifests, or source machinery to the user.",
  ].join("\n");
}
