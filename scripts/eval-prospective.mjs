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
  for (let i = 0; i < 40; i++) {
    const doc = await engineDoc(id);
    if (doc.status === "done" || doc.status === "failed") return doc.status;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return "timeout";
};

let pass = 0;
let fail = 0;
const cleanup = [];
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
    topic: "prospective-eval Vienna",
    action: "ask about pricing",
    source: "eval-prospective",
  });
  const exactId = exact.data.trigger?.id;
  if (exactId) cleanup.push(exactId);
  check(exact.status === 200 && !!exactId, "creates a context-triggered commitment");
  check((await settle(exactId)) === "done", "new trigger settles before lifecycle mutation");

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
    context: "prospective-eval Vienna came up on the call",
    seen: [],
  });
  check(
    match.data.match?.id === exactId && match.data.match?.match === "exact",
    "exact topic match wins",
    JSON.stringify(match.data.match),
  );

  const cooled = await post({
    operation: "match",
    context: "prospective-eval Vienna came up again",
    seen: [exactId],
  });
  check(cooled.data.match === null, "per-session seen IDs prevent repeated nudges");

  const fired = await post({
    operation: "fire",
    id: exactId,
    reason: "exact topic returned",
  });
  check(fired.status === 200 && fired.data.operation === "fire", "fires once");

  const after = await post({
    operation: "match",
    context: "prospective-eval Vienna once more",
    seen: [],
  });
  check(after.data.match === null, "consumed trigger cannot fire twice");

  const history = await get("/api/prospective?space=eval&closed=true");
  const closed = (history.triggers ?? []).find((item) => item.id === exactId);
  check(closed?.status === "done" && !!closed?.firedAt, "fired trigger remains as dated history");

  const fuzzy = await post({
    operation: "create",
    topic: "prospective-eval Leipzig pilot pricing",
    action: "ask whether the quote changed",
    source: "eval-prospective",
  });
  const fuzzyId = fuzzy.data.trigger?.id;
  if (fuzzyId) cleanup.push(fuzzyId);
  check((await settle(fuzzyId)) === "done", "second trigger settles");
  const fuzzyMatch = await post({
    operation: "match",
    context: "Pricing for the prospective-eval Leipzig customer pilot changed",
    seen: [],
  });
  check(
    fuzzyMatch.data.match?.id === fuzzyId && fuzzyMatch.data.match?.match === "fuzzy",
    "guarded fuzzy fallback requires strong topic coverage",
    JSON.stringify(fuzzyMatch.data.match),
  );

  const snoozed = await post({ operation: "snooze", id: fuzzyId });
  check(snoozed.status === 200 && snoozed.data.operation === "snooze", "snoozes explicitly");
  const quiet = await post({
    operation: "match",
    context: "prospective-eval Leipzig pilot pricing",
    seen: [],
  });
  check(quiet.data.match === null, "snoozed topic stays quiet");
} finally {
  await Promise.all(cleanup.map(remove));
}

console.log(`\n${pass}/${pass + fail} prospective checks passed`);
if (fail) process.exitCode = 1;
