import { getMemoryEventLedger } from "../lib/memory/event-ledger.ts";
import { materializeContinuityKernel } from "../lib/memory/continuity-kernel.ts";
import { listAllSupermemoryDocuments, planLegacyImport } from "../lib/memory/legacy-import.ts";

const base = process.argv.find((value) => value.startsWith("http")) ?? "http://localhost:3001";
const checks = [];
const check = (ok, name, detail) => checks.push({ ok: Boolean(ok), name, detail });

const ledger = getMemoryEventLedger();
const queues = ledger.operationalQueueStats(["personal", "work", "health"]);
const evaluationQueues = ledger.operationalQueueStats(["eval"]);
check(ledger.stats().integrity === "ok", "canonical SQLite integrity", ledger.stats().integrity);
check(
  queues.jobs.pending + queues.jobs.processing + queues.jobs.dead === 0,
  "user semantic mirror queue",
  JSON.stringify(queues.jobs),
);
check(
  queues.stateJobs.pending + queues.stateJobs.processing + queues.stateJobs.dead === 0,
  "user projection/deletion queue",
  JSON.stringify(queues.stateJobs),
);
check(
  evaluationQueues.jobs.pending +
    evaluationQueues.jobs.processing +
    evaluationQueues.jobs.succeeded +
    evaluationQueues.jobs.dead +
    evaluationQueues.stateJobs.pending +
    evaluationQueues.stateJobs.processing +
    evaluationQueues.stateJobs.succeeded +
    evaluationQueues.stateJobs.dead ===
    0,
  "isolated evaluation queues are clean",
  JSON.stringify(evaluationQueues),
);

const documents = await listAllSupermemoryDocuments("personal");
check(documents.length > 0, "Supermemory Local availability", `${documents.length} personal documents`);
const evaluationDocuments = await listAllSupermemoryDocuments("eval");
check(
  evaluationDocuments.length === 0,
  "isolated evaluation provider corpus is clean",
  `${evaluationDocuments.length} documents`,
);
const plan = planLegacyImport({ documents, ledger, space: "personal" });
check(plan.counts.blocked === 0, "legacy migration blockers", `${plan.counts.blocked} blocked`);
check(plan.counts.import === 0, "legacy corpus adoption", `${plan.counts.import} documents remain`);

const materialized = materializeContinuityKernel({ space: "personal", force: true });
check(
  materialized.kernel.tokenCount <= 5_000,
  "continuity kernel budget",
  `${materialized.kernel.tokenCount}/5000 tokens`,
);
check(
  materialized.kernel.invalidatedAt === null,
  "continuity kernel freshness",
  materialized.kernel.compiledAt,
);

const foundation = await fetch(`${base}/api/memory/foundation`).then((response) =>
  response.ok ? response.json() : null,
).catch(() => null);
check(foundation?.health?.releaseReady === true, "live foundation health", foundation?.health?.status ?? "unavailable");

const agentId = process.env.ELEVENLABS_AGENT_ID;
const agentKey = process.env.ELEVENLABS_API_KEY;
let agent = null;
if (agentId && agentKey) {
  agent = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    headers: { "xi-api-key": agentKey },
  }).then((response) => (response.ok ? response.json() : null)).catch(() => null);
}
const config = agent?.conversation_config;
const prompt = config?.agent?.prompt;
check(!!agent, "ElevenLabs agent availability", agent ? agentId : "unavailable");
check(
  typeof prompt?.prompt === "string" && prompt.prompt.includes("{{presence}}") && prompt.prompt.includes("{{continuity_kernel}}"),
  "voice continuity variables",
  "presence + continuity kernel",
);
check(
  config?.tts?.model_id === "eleven_v3_conversational" && config?.tts?.expressive_mode === true,
  "expressive voice configuration",
  `${config?.tts?.model_id ?? "missing"}; expressive=${String(config?.tts?.expressive_mode)}`,
);
check(
  config?.turn?.turn_model === "turn_v3" && config?.turn?.speculative_turn === true,
  "turn-taking configuration",
  `${config?.turn?.turn_model ?? "missing"}; speculative=${String(config?.turn?.speculative_turn)}`,
);
check(!!prompt?.built_in_tools?.skip_turn, "intelligent silence tool", "skip_turn");

for (const item of checks) {
  console.log(`${item.ok ? "✅" : "🟥"}  ${item.name} — ${item.detail}`);
}
const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`\nMemory preflight failed: ${failed.length}/${checks.length} checks need attention.`);
  process.exit(1);
}
console.log(`\n✅  Memory preflight ready: ${checks.length}/${checks.length} checks passed.`);
