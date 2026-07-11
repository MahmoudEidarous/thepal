// The librarian reshelves: existing captures carry entities without a
// kind (person/place/thread/thing). One classification call over all
// unique names, then a metadata PATCH per doc. Only touches docs whose
// entities lack the #kind suffix — safe to re-run.
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3001";
const SM = "http://localhost:6767";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const captures = (await fetch(`${BASE}/api/captures`).then((r) => r.json())).captures ?? [];
const stale = captures.filter(
  (c) => typeof c.meta.entities === "string" && !c.meta.entities.includes("#"),
);
console.log(`${stale.length} docs carry unshelved entities`);
if (!stale.length) process.exit(0);

// unique canonical names with one context line each
const context = new Map();
for (const c of stale) {
  for (const raw of c.meta.entities.split(", ")) {
    const name = raw.split("/")[0]?.trim();
    if (name && !context.has(name.toLowerCase()))
      context.set(name.toLowerCase(), { name, sample: c.text.slice(0, 90) });
  }
}
const names = [...context.values()];
console.log(`${names.length} unique entities to classify`);

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'Classify each entity from a personal memory system. Kinds: "person" (a human), "place" (city/neighborhood/venue/country), "thread" (an ongoing storyline: a move, a pilot, an application, a course, a project-in-motion), "thing" (org/company/product/object/team). Reply with a single JSON object mapping every given name to its kind.',
      },
      {
        role: "user",
        content: names.map((n) => `${n.name} — mentioned in: "${n.sample}"`).join("\n"),
      },
    ],
  }),
}).then((r) => r.json());

const kinds = JSON.parse(res.choices?.[0]?.message?.content ?? "{}");
const kindOf = (name) => {
  const k = kinds[name] ?? kinds[name.toLowerCase()];
  return ["person", "place", "thread", "thing"].includes(k) ? k : "thing";
};
const dist = {};
Object.values(kinds).forEach((k) => (dist[k] = (dist[k] ?? 0) + 1));
console.log("classified:", JSON.stringify(dist));

let patched = 0;
for (const c of stale) {
  const entities = c.meta.entities
    .split(", ")
    .map((raw) => `${raw}#${kindOf(raw.split("/")[0]?.trim() ?? "")}`)
    .join(", ");
  const r = await fetch(`${SM}/v3/documents/${c.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadata: { ...c.meta, entities } }),
  });
  if (r.ok) patched++;
  else console.log(`PATCH ${c.id} -> ${r.status}`);
}
console.log(`reshelved ${patched}/${stale.length} docs`);
