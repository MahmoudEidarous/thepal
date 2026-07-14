// Prospective-memory integrity bank. Exercises the production API in the
// quarantined eval space: exact-before-fuzzy matching, agenda isolation,
// per-session cooldown, one-shot consumption, snooze and history.
// Usage: node scripts/eval-prospective.mjs [baseUrl]
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3001";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")).trim(),
      line.slice(line.indexOf("=") + 1).trim(),
    ]),
);
const ENGINE = env.SUPERMEMORY_BASE_URL ?? "http://localhost:6767";
const KEY = env.SUPERMEMORY_API_KEY;

const post = async (body) => {
  const response = await fetch(`${BASE}/api/prospective`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ space: "eval", ...body }),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
};
const get = (path) => fetch(`${BASE}${path}`).then((response) => response.json());
const remove = (id) =>
  fetch(`${ENGINE}/v3/documents/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${KEY}` },
  }).catch(() => null);
const engineDoc = (id) =>
  fetch(`${ENGINE}/v3/documents/${id}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  }).then((response) => response.json().catch(() => ({})));
const settle = async (id) => {
  // A cold local Supermemory worker can spend more than 40 seconds on the
  // first document after startup. This is a lifecycle race gate, not a
  // latency assertion, so leave enough room for cold processing to settle.
  for (let i = 0; i < 80; i++) {
    const doc = await engineDoc(id);
    if (doc.status === "done" || doc.status === "failed") return doc.status;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return "timeout";
};

let pass = 0;
let fail = 0;
const cleanup = [];
const run = `run-${Date.now().toString(36)}`;
const check = (ok, label, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`✅  ${label}`);
  } else {
    fail += 1;
    console.log(`🟥  FAIL — ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

try {
  const exact = await post({
    operation: "create",
    topic: `${run} Aster summit`,
    action: "ask about pricing",
    source: "eval-prospective",
  });
  const exactId = exact.data.trigger?.id;
  const exactProviderId = exact.data.trigger?.providerExternalId;
  const exactCleanup = exactId
    ? { triggerId: exactId, providerId: exactProviderId, eventIds: [exactId] }
    : null;
  if (exactCleanup) cleanup.push(exactCleanup);
  check(exact.status === 200 && !!exactId, "creates a context-triggered commitment");
  check(!!exactProviderId && (await settle(exactProviderId)) === "done", "new trigger settles before lifecycle mutation");

  const agenda = await get("/api/agenda?space=eval");
  check(
    !(agenda.commitments ?? []).some((item) => item.id === exactId),
    "prospective memory never leaks into the dated agenda",
  );

  const unrelated = await post({
    operation: "match",
    context: "The weather in Berlin is clear",
    seen: [],
  });
  check(unrelated.data.match === null, "unrelated context does not trigger");

  const match = await post({
    operation: "match",
    context: `${run} Aster summit came up on the call`,
    seen: [],
  });
  check(
    match.data.match?.id === exactId && match.data.match?.match === "exact",
    "exact topic match wins",
    JSON.stringify(match.data.match),
  );

  const cooled = await post({
    operation: "match",
    context: `${run} Aster summit came up again`,
    seen: [exactId],
  });
  check(cooled.data.match === null, "per-session seen IDs prevent repeated nudges");

  const fired = await post({
    operation: "fire",
    id: exactId,
    reason: "exact topic returned",
  });
  if (exactCleanup && fired.data.trigger?.lastEventId) {
    exactCleanup.eventIds.push(fired.data.trigger.lastEventId);
  }
  check(fired.status === 200 && fired.data.operation === "fire", "fires once");

  const after = await post({
    operation: "match",
    context: `${run} Aster summit once more`,
    seen: [],
  });
  check(after.data.match === null, "consumed trigger cannot fire twice");

  const history = await get("/api/prospective?space=eval&closed=true");
  const closed = (history.triggers ?? []).find((item) => item.id === exactId);
  check(closed?.status === "done" && !!closed?.firedAt, "fired trigger remains as dated history");

  const fuzzy = await post({
    operation: "create",
    topic: `${run} Kestrel pilot pricing`,
    action: "ask whether the quote changed",
    source: "eval-prospective",
  });
  const fuzzyId = fuzzy.data.trigger?.id;
  const fuzzyProviderId = fuzzy.data.trigger?.providerExternalId;
  const fuzzyCleanup = fuzzyId
    ? { triggerId: fuzzyId, providerId: fuzzyProviderId, eventIds: [fuzzyId] }
    : null;
  if (fuzzyCleanup) cleanup.push(fuzzyCleanup);
  check(!!fuzzyProviderId && (await settle(fuzzyProviderId)) === "done", "second trigger settles");
  const fuzzyMatch = await post({
    operation: "match",
    context: `Pricing for the ${run} Kestrel customer pilot changed`,
    seen: [],
  });
  check(
    fuzzyMatch.data.match?.id === fuzzyId && fuzzyMatch.data.match?.match === "fuzzy",
    "guarded fuzzy fallback requires strong topic coverage",
    JSON.stringify(fuzzyMatch.data.match),
  );

  const snoozed = await post({ operation: "snooze", id: fuzzyId });
  if (fuzzyCleanup && snoozed.data.trigger?.lastEventId) {
    fuzzyCleanup.eventIds.push(snoozed.data.trigger.lastEventId);
  }
  check(snoozed.status === 200 && snoozed.data.operation === "snooze", "snoozes explicitly");
  const quiet = await post({
    operation: "match",
    context: `${run} Kestrel pilot pricing`,
    seen: [],
  });
  check(quiet.data.match === null, "snoozed topic stays quiet");
} finally {
  for (const item of cleanup) {
    for (const eventId of [...new Set(item.eventIds)].reverse()) {
      const preview = await fetch(`${BASE}/api/memory/deletions/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      }).then((response) => response.json().catch(() => null));
      if (preview?.token) {
        await fetch(`${BASE}/api/memory/deletions/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: preview.token }),
        }).catch(() => null);
      }
    }
    if (item.providerId) await remove(item.providerId);
  }
}

console.log(`\n${pass}/${pass + fail} prospective checks passed`);
if (fail) process.exitCode = 1;
