import assert from "node:assert/strict";
import {
  KNOWLEDGE_ROUTER_VERSION,
  formatKnowledgeRoute,
  knowledgeToolAllowed,
  routeKnowledgeTurn,
} from "../lib/knowledge-router.ts";

const cases = [
  ["I swear Mondays hate me", "conversation", "social", []],
  ["Do you think people really change?", "conversation", "social", []],
  ["Blue or black?", "conversation", "social", []],
  ["I'm nervous about tonight", "conversation", "social", []],
  ["Tell me a joke", "conversation", "social", []],
  ["Help me brainstorm names for this", "conversation", "social", []],
  ["That is absolutely wild", "conversation", "social", []],
  ["Should I call him?", "conversation", "social", []],
  ["Why is the sky blue?", "general_knowledge", "general", []],
  ["What's the difference between TCP and UDP?", "general_knowledge", "general", []],
  ["Does black absorb more heat?", "general_knowledge", "general", []],
  ["How do neural networks learn?", "general_knowledge", "general", []],
  ["When did I move to Berlin?", "personal_memory", "personal_history", ["search_memories"]],
  ["What did I tell you about Vienna?", "personal_memory", "personal_history", ["search_memories"]],
  ["Why do I always choose black?", "personal_memory", "personal_history", ["search_memories"]],
  ["Do you remember Layla's interview?", "personal_memory", "personal_history", ["search_memories"]],
  ["What do I prefer?", "personal_memory", "profile", ["get_profile", "search_memories"]],
  ["What's my favorite color?", "personal_memory", "profile", ["get_profile", "search_memories"]],
  ["Have I ever told you about Karim?", "personal_memory", "personal_history", ["search_memories"]],
  ["Last time I spoke about the lease, what happened?", "personal_memory", "personal_history", ["search_memories"]],
  ["What's still going on?", "structured_state", "threads", ["get_life_threads"]],
  ["What am I waiting on?", "structured_state", "threads", ["get_life_threads"]],
  ["Show me my open loops", "structured_state", "threads", ["get_life_threads"]],
  ["Which situations are blocked?", "structured_state", "threads", ["get_life_threads"]],
  ["Where did we leave the Vienna pilot?", "structured_state", "threads", ["get_life_threads"]],
  ["What's unresolved in my life?", "structured_state", "threads", ["get_life_threads"]],
  ["What are my active life threads?", "structured_state", "threads", ["get_life_threads"]],
  ["What's still going on with the visa?", "structured_state", "threads", ["get_life_threads"]],
  ["Take me through my week", "structured_state", "continuity", ["get_continuity"]],
  ["What changed during my last month?", "structured_state", "continuity", ["get_continuity"]],
  ["Show me my monthly arc", "structured_state", "continuity", ["get_continuity"]],
  ["Tell me about Layla", "personal_memory", "continuity", ["get_continuity", "search_memories"]],
  ["What's going on with Project Meridian?", "personal_memory", "continuity", ["get_continuity", "search_memories"]],
  ["Show me the dossier for Vienna", "personal_memory", "continuity", ["get_continuity", "search_memories"]],
  ["What routines have you noticed?", "structured_state", "continuity", ["get_continuity"]],
  ["Show me my recurring patterns", "structured_state", "continuity", ["get_continuity"]],
  ["What happened a year ago today?", "structured_state", "continuity", ["get_continuity"]],
  ["Anything from this day?", "structured_state", "continuity", ["get_continuity"]],
  ["What are our inside jokes?", "structured_state", "continuity", ["get_continuity"]],
  ["Do we have any shared callbacks?", "structured_state", "continuity", ["get_continuity"]],
  ["What do I owe Karim?", "structured_state", "agenda", ["get_agenda"]],
  ["What's on my plate?", "structured_state", "agenda", ["get_agenda"]],
  ["What is due?", "structured_state", "agenda", ["get_agenda"]],
  ["What were you supposed to remind me about?", "structured_state", "prospective", ["get_prospective_memories"]],
  ["Any next-time reminders waiting?", "structured_state", "prospective", ["get_prospective_memories"]],
  ["Give me my briefing", "structured_state", "briefing", ["get_briefing"]],
  ["What did you dream?", "structured_state", "briefing", ["get_briefing"]],
  ["How have I been feeling lately?", "personal_memory", "emotional_history", ["get_emotional_weather", "search_memories"]],
  ["What was my mood this month?", "personal_memory", "emotional_history", ["get_emotional_weather", "search_memories"]],
  ["Take me through my Vienna story", "personal_memory", "story", ["show_story", "search_memories"]],
  ["Show me my week", "personal_memory", "story", ["show_story", "search_memories"]],
  ["What's the score right now?", "live_web", "world", ["search_web"]],
  ["Is the Egyptian Museum open now?", "live_web", "world", ["search_web"]],
  ["What's the exchange rate today?", "live_web", "world", ["search_web"]],
  ["What's the weather tomorrow?", "live_web", "weather", ["get_weather"]],
  ["Look this up online: ElevenLabs pricing", "live_web", "world", ["search_web"]],
  ["What is the latest Next.js version?", "live_web", "world", ["search_web"]],
  ["Is this medication dose safe?", "live_web", "world", ["search_web"]],
  ["What are the current visa requirements?", "live_web", "world", ["search_web"]],
  ["Given what I told you about my insomnia, what do current studies say about coffee at 7pm?", "hybrid", "hybrid", ["resolve_hybrid_context"]],
  ["Will tomorrow's Cairo weather affect my usual morning run?", "hybrid", "hybrid", ["resolve_hybrid_context"]],
  ["Search current advice based on what you remember about my knee", "hybrid", "hybrid", ["resolve_hybrid_context"]],
  ["Remember that the Vienna call moved to Friday", "conversation", "state_change", []],
  ["Next time Vienna comes up remind me about pricing", "conversation", "state_change", []],
  ["Forget everything about the old job", "conversation", "state_change", []],
  ["Mark the invoice complete", "conversation", "state_change", []],
];

let checks = 0;
for (const [query, kind, domain, tools] of cases) {
  const decision = routeKnowledgeTurn({ query });
  assert.equal(decision.kind, kind, `${query}: kind`);
  checks += 1;
  assert.equal(decision.domain, domain, `${query}: domain`);
  checks += 1;
  assert.deepEqual(decision.allowedRetrievalTools, tools, `${query}: tools`);
  checks += 1;
}

const current = routeKnowledgeTurn({
  query: "What do you think about that?",
  recentTurns: [
    { role: "user", text: "I'm considering moving the launch." },
    { role: "agent", text: "Friday would give you breathing room." },
  ],
});
assert.equal(current.kind, "conversation");
assert.equal(current.domain, "current_turn");
checks += 2;

const ambiguous = routeKnowledgeTurn({ query: "What about that?" });
assert.equal(ambiguous.kind, "clarify");
assert.equal(ambiguous.domain, "ambiguous");
checks += 2;

const canonical = routeKnowledgeTurn({
  query: "What do I prefer?",
  coverage: { canonicalItems: 2 },
});
assert.equal(canonical.kind, "supplied_context");
assert.deepEqual(canonical.allowedRetrievalTools, []);
checks += 2;

const episodicNeedsHistory = routeKnowledgeTurn({
  query: "When did I move to Berlin?",
  coverage: { canonicalItems: 2 },
});
assert.equal(episodicNeedsHistory.kind, "personal_memory");
checks += 1;

const episodicSupplied = routeKnowledgeTurn({
  query: "When did I move to Berlin?",
  coverage: { historicalItems: 1 },
});
assert.equal(episodicSupplied.kind, "supplied_context");
checks += 1;

const honestMiss = routeKnowledgeTurn({
  query: "When did I move to Berlin?",
  coverage: { semanticHistoryChecked: true },
});
assert.equal(honestMiss.kind, "supplied_context");
checks += 1;

const emptyAgenda = routeKnowledgeTurn({
  query: "What's on my plate?",
  coverage: { commitmentsChecked: true },
});
assert.equal(emptyAgenda.kind, "structured_state");
assert.deepEqual(emptyAgenda.allowedRetrievalTools, ["get_agenda"]);
checks += 1;
checks += 1;

const emptyProspective = routeKnowledgeTurn({
  query: "What were you supposed to remind me about?",
  coverage: { prospectiveChecked: true },
});
assert.equal(emptyProspective.kind, "structured_state");
assert.deepEqual(emptyProspective.allowedRetrievalTools, ["get_prospective_memories"]);
checks += 1;
checks += 1;

const hybridPersonalSupplied = routeKnowledgeTurn({
  query: "Given what I told you about insomnia, what do current studies say?",
  coverage: { historicalItems: 1 },
});
assert.equal(hybridPersonalSupplied.kind, "hybrid");
assert.deepEqual(hybridPersonalSupplied.allowedRetrievalTools, ["search_web"]);
checks += 2;

const personal = routeKnowledgeTurn({ query: "What did I say about Vienna?" });
assert.equal(knowledgeToolAllowed(personal, "search_memories"), true);
assert.equal(knowledgeToolAllowed(personal, "search_web"), false);
checks += 2;

const world = routeKnowledgeTurn({ query: "What's the score right now?" });
assert.equal(knowledgeToolAllowed(world, "search_web"), true);
assert.equal(knowledgeToolAllowed(world, "search_memories"), false);
checks += 2;

const social = routeKnowledgeTurn({ query: "Tell me a joke" });
assert.equal(knowledgeToolAllowed(social, "search_memories"), false);
assert.equal(knowledgeToolAllowed(social, "search_web"), false);
checks += 2;

const formatted = formatKnowledgeRoute(canonical);
assert.match(formatted, new RegExp(KNOWLEDGE_ROUTER_VERSION));
assert.match(formatted, /internal policy/i);
assert.doesNotMatch(formatted, /what do i prefer/i);
checks += 3;

console.log(`${checks} knowledge-router checks passed`);
