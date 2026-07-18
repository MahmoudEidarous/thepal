import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildObservedEvidence,
  observeUserTurn,
  sanitizeObservationTurns,
} from "../lib/memory/turn-observer.ts";

let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
};

const turns = sanitizeObservationTurns([
  { role: "user", text: "Dina Calder is my friend from university." },
  { role: "agent", text: "What makes Alexandria feel like yours together?" },
  { role: "invalid", text: "drop me" },
  null,
]);
check(turns.length === 2, "observer accepts only valid conversation turns");
check(turns[0].role === "user", "observer preserves user evidence role");
check(turns[1].role === "agent", "observer preserves agent context role");

const relational = await observeUserTurn(
  {
    text: "I love going to Alexandria because of her, and we always have real quality time together.",
    recentTurns: turns,
  },
  async () => ({
    capture: true,
    kind: "memory",
    reason: "relationship_texture",
    contextUserIndexes: [0],
  }),
);
check(relational.capture, "relationship texture is captured");
check(relational.reason === "relationship_texture", "relationship reason survives");
check(relational.fallback === false, "model decision is identified");
check(
  relational.content?.includes("Dina Calder is my friend from university."),
  "necessary direct user context identifies the person",
);
check(
  relational.content?.includes("I love going to Alexandria because of her"),
  "latest relational evidence is preserved exactly",
);
check(
  !relational.content?.includes("What makes Alexandria"),
  "agent language never becomes direct user evidence",
);

const question = await observeUserTurn(
  { text: "Why is Alexandria humid?", recentTurns: turns },
  async () => ({
    capture: false,
    kind: "memory",
    reason: "question_only",
    contextUserIndexes: [],
  }),
);
check(!question.capture, "pure questions are skipped");
check(question.content === null, "skipped turns create no evidence content");

let optOutGeneratorCalled = false;
const optOut = await observeUserTurn(
  { text: "Don't remember this, but I am leaving Alexandria tomorrow." },
  async () => {
    optOutGeneratorCalled = true;
    throw new Error("must not run");
  },
);
check(!optOut.capture, "explicit memory opt-out wins");
check(optOut.reason === "privacy_opt_out", "opt-out has an auditable reason");
check(!optOutGeneratorCalled, "opt-out bypasses the model entirely");

const invalidContext = await observeUserTurn(
  { text: "We spend the whole afternoon talking by the water.", recentTurns: turns },
  async () => ({
    capture: true,
    kind: "memory",
    reason: "relationship_texture",
    contextUserIndexes: [1, 7],
  }),
);
check(invalidContext.capture, "durable current evidence still lands");
check(
  invalidContext.content === "We spend the whole afternoon talking by the water.",
  "agent and out-of-range context indexes are ignored",
);

const fallback = await observeUserTurn(
  {
    text: "I love going to Alexandria because of her and we spend entire afternoons laughing together.",
    recentTurns: turns,
  },
  async () => {
    throw new Error("provider timeout");
  },
);
check(fallback.capture, "long personal telling survives classifier failure");
check(fallback.fallback, "fallback use is visible to telemetry");
check(
  fallback.content?.startsWith("Dina Calder is my friend from university."),
  "fallback resolves a relational pronoun from direct user context",
);

const fallbackSmallTalk = await observeUserTurn(
  { text: "Yeah okay cool." },
  async () => {
    throw new Error("provider timeout");
  },
);
check(!fallbackSmallTalk.capture, "fallback does not file small talk");

const exact = buildObservedEvidence(
  "Dina and I walk by the sea.",
  [
    { role: "user", text: "Dina Calder is my university friend." },
    { role: "user", text: "Dina Calder is my university friend." },
  ],
  [0, 1],
);
check(
  exact === "Dina Calder is my university friend.\nDina and I walk by the sea.",
  "evidence bundling deduplicates without paraphrasing",
);

const prompt = readFileSync(new URL("./create-voice-agent.mjs", import.meta.url), "utf8");
check(/Most memory calls need NO preamble/.test(prompt), "memory retrieval no longer requires a preamble");
check(/Never use a stock holding line/.test(prompt), "stock holding lines are explicitly forbidden");
check(/never repeat the same pre-tool rhythm/i.test(prompt), "repeated pre-tool rhythm is forbidden");
check(/relationship meaning/.test(prompt), "relationship meaning is a first-class save target");
check(/what they do together/.test(prompt), "shared activities are a first-class save target");
check(/person already has a card/i.test(prompt), "known people can receive new texture");

const client = readFileSync(new URL("../components/voice-panel.tsx", import.meta.url), "utf8");
check(/\/api\/memory\/observe/.test(client), "every voice turn reaches the background observer");
check(/memoryObservationQueueRef/.test(client), "observer work is serialized off the voice path");
check(/voice-turn:\$\{sessionIdRef\.current\}:\$\{turn\}/.test(client), "model and observer share turn idempotency");
check(/deliberately NOT cancelled by a newer turn/.test(client), "new topics do not erase earlier evidence writes");
check(/latestUserEvidence \|\| content/.test(client), "model paraphrases cannot replace direct transcript evidence");

const observeRoute = readFileSync(
  new URL("../app/api/memory/observe/route.ts", import.meta.url),
  "utf8",
);
check(/captured\.receipt\.duplicate/.test(observeRoute), "observer detects a model-write race");
check(/idempotencyKey}:observer/.test(observeRoute), "richer exact evidence supplements a partial model write once");

console.log(`${checks} memory-observer checks passed`);
