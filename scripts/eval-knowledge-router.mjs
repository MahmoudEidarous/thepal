import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KNOWLEDGE_ROUTER_VERSION,
  MODEL_DIRECTED_RETRIEVAL_TOOLS,
  formatKnowledgeRoute,
  knowledgeToolAllowed,
  routeKnowledgeTurn,
} from "../lib/knowledge-router.ts";

const queries = [
  "Tell me a joke",
  "Why is the sky blue?",
  "What is my name?",
  "When did we start Fahras?",
  "What is still going on with Vienna?",
  "What is on my agenda and what happened with Karim?",
  "What is the weather tomorrow?",
  "Given what you know about my knee, what does current guidance say?",
  "Take me through my week",
  "Next time Vienna comes up remind me about pricing",
  "Forget everything about the old job",
  "What about that?",
];

let checks = 0;
for (const query of queries) {
  const decision = routeKnowledgeTurn({ query });
  assert.equal(decision.contractVersion, 1, `${query}: contract`);
  checks += 1;
  assert.equal(decision.routerVersion, KNOWLEDGE_ROUTER_VERSION, `${query}: version`);
  checks += 1;
  assert.equal(decision.kind, "model_directed", `${query}: source owner`);
  checks += 1;
  assert.equal(decision.domain, "adaptive", `${query}: adaptive domain`);
  checks += 1;
  assert.deepEqual(
    decision.allowedRetrievalTools,
    MODEL_DIRECTED_RETRIEVAL_TOOLS,
    `${query}: the model can choose every read authority`,
  );
  checks += 1;
}

const compound = routeKnowledgeTurn({
  query: "What do I owe Karim, what happened last time, and is tomorrow's weather relevant?",
});
for (const tool of MODEL_DIRECTED_RETRIEVAL_TOOLS) {
  assert.equal(knowledgeToolAllowed(compound, tool), true, `${tool}: available to model`);
  checks += 1;
}

const supplied = routeKnowledgeTurn({
  query: "When did I move to Berlin?",
  selectedMemory: "Berlin lease",
  coverage: {
    canonicalItems: 2,
    threadItems: 3,
    structuredItems: 4,
    historicalItems: 5,
    continuityItems: 6,
    semanticHistoryChecked: true,
    commitmentsChecked: true,
    prospectiveChecked: true,
    degradedSources: ["semantic history", "semantic history", "web"],
  },
});
assert.equal(supplied.coverage.selectedMemory, true);
checks += 1;
assert.equal(supplied.coverage.canonicalItems, 2);
checks += 1;
assert.equal(supplied.coverage.threadItems, 3);
checks += 1;
assert.equal(supplied.coverage.structuredItems, 4);
checks += 1;
assert.equal(supplied.coverage.historicalItems, 5);
checks += 1;
assert.equal(supplied.coverage.continuityItems, 6);
checks += 1;
assert.equal(supplied.coverage.semanticHistoryChecked, true);
checks += 1;
assert.equal(supplied.coverage.commitmentsChecked, true);
checks += 1;
assert.equal(supplied.coverage.prospectiveChecked, true);
checks += 1;
assert.deepEqual(supplied.coverage.degradedSources, ["semantic history", "web"]);
checks += 1;

const formatted = formatKnowledgeRoute(supplied);
assert.match(formatted, new RegExp(KNOWLEDGE_ROUTER_VERSION));
checks += 1;
assert.match(formatted, /model owns source selection/i);
checks += 1;
assert.match(formatted, /zero tools/i);
checks += 1;
assert.match(formatted, /multiple tools/i);
checks += 1;
assert.match(formatted, /private personal details/i);
checks += 1;
assert.match(formatted, /live-world tools/i);
checks += 1;
assert.match(formatted, /5 episodes/i);
checks += 1;
assert.doesNotMatch(formatted, /when did i move to berlin/i);
checks += 1;

const prompt = readFileSync(new URL("./create-voice-agent.mjs", import.meta.url), "utf8");
assert.match(prompt, /You—not a keyword router—choose how to answer every turn/);
checks += 1;
assert.match(prompt, /no tool, one tool, or several complementary tools/i);
checks += 1;
assert.match(prompt, /Never send private personal details to web search/i);
checks += 1;
assert.match(prompt, /agenda \+ memory history/);
checks += 1;
assert.doesNotMatch(prompt, /It is law for retrieval on that turn/);
checks += 1;
assert.doesNotMatch(prompt, /allowed-retrieval line is exhaustive/i);
checks += 1;

const voicePanel = readFileSync(
  new URL("../components/voice-panel.tsx", import.meta.url),
  "utf8",
);
assert.doesNotMatch(voicePanel, /gateKnowledgeTool/);
checks += 1;
assert.doesNotMatch(voicePanel, /SOURCE ROUTER BLOCKED/);
checks += 1;
assert.doesNotMatch(voicePanel, /sendContextualUpdate\(formatKnowledgeRoute/);
checks += 1;
assert.match(voicePanel, /There is no\s+\/\/ per-turn browser classification/);
checks += 1;

console.log(`${checks} model-directed knowledge-policy checks passed`);
