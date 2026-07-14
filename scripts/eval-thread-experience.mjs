import assert from "node:assert/strict";
import { buildThreadView, sortThreads, threadMatchesQuery } from "../lib/memory/thread-view.ts";

const AT = "2026-07-15T12:00:00.000Z";
const evidence = "00000000-0000-4000-a000-000000000001";

function thread(overrides = {}) {
  const id = overrides.id ?? "10000000-0000-4000-a000-000000000001";
  const title = overrides.title ?? "Vienna pilot";
  return {
    id,
    userId: "fixture-user",
    space: "eval",
    anchorKey: overrides.anchorKey ?? `project:${title.toLowerCase().replaceAll(" ", "-")}`,
    title,
    kind: overrides.kind ?? "project",
    status: overrides.status ?? "open",
    currentState: {
      text: overrides.state ?? `${title}: scheduled for review`,
      beliefKeys: [`belief:${id}`],
      evidenceEventIds: [evidence],
      confidence: overrides.confidence ?? "direct",
    },
    participants: overrides.participants ?? [],
    commitments: overrides.commitments ?? [],
    expectedNext: overrides.expectedNext ?? null,
    lastMeaningfulChangeAt: overrides.changedAt ?? "2026-07-10T12:00:00.000Z",
    nextReviewAt: overrides.nextReviewAt ?? null,
    evidenceEventIds: [evidence],
    beliefKeys: [`belief:${id}`],
    resolution: overrides.resolution ?? null,
    confidence: overrides.confidence ?? "direct",
    projectorVersion: "threads-v1",
  };
}

const threads = [
  thread({
    id: "10000000-0000-4000-a000-000000000001",
    title: "Vienna pilot",
    expectedNext: {
      event: "pricing review",
      by: { start: "2026-07-14", end: "2026-07-14", precision: "day" },
      evidenceEventIds: [evidence],
    },
    nextReviewAt: "2026-07-14T12:00:00.000Z",
    commitments: [
      {
        eventId: "20000000-0000-4000-a000-000000000001",
        content: "Send the Vienna pricing deck",
        due: "2026-07-16",
        status: "open",
        closedByEventId: null,
      },
    ],
  }),
  thread({
    id: "10000000-0000-4000-a000-000000000002",
    title: "Visa application",
    kind: "waiting",
    status: "waiting",
    state: "Visa application: waiting for embassy response",
    participants: [{ id: "person:karim", kind: "person", label: "Karim" }],
    expectedNext: {
      event: "embassy response",
      by: { start: "2026-07-16", end: "2026-07-16", precision: "day" },
      evidenceEventIds: [evidence],
    },
    nextReviewAt: "2026-07-14T12:00:00.000Z",
  }),
  thread({
    id: "10000000-0000-4000-a000-000000000003",
    title: "Atlas launch",
    status: "blocked",
    state: "Atlas launch: blocked by App Store review",
  }),
  thread({
    id: "10000000-0000-4000-a000-000000000004",
    title: "Sunday planning",
    kind: "routine",
    status: "emerging",
    confidence: "tentative",
  }),
  thread({
    id: "10000000-0000-4000-a000-000000000005",
    title: "Studio search",
    kind: "place",
    status: "dormant",
  }),
  thread({
    id: "10000000-0000-4000-a000-000000000006",
    title: "Old lease",
    kind: "decision",
    status: "resolved",
    resolution: {
      eventId: evidence,
      reason: "Old lease: finished",
      resolvedAt: "2026-07-12T12:00:00.000Z",
    },
  }),
];

const transitions = [
  {
    id: "30000000-0000-4000-a000-000000000001",
    threadId: threads[0].id,
    kind: "created",
    fromStatus: null,
    toStatus: "open",
    at: "2026-07-10T12:00:00.000Z",
    reason: "first grounded thread signal",
    state: "Vienna pilot created",
    evidenceEventIds: [evidence],
    projectorVersion: "threads-v1",
  },
  {
    id: "30000000-0000-4000-a000-000000000002",
    threadId: threads[0].id,
    kind: "state_updated",
    fromStatus: "open",
    toStatus: "open",
    at: "2026-07-12T12:00:00.000Z",
    reason: "new evidence updated the situation",
    state: "Vienna pricing review scheduled",
    evidenceEventIds: [evidence],
    projectorVersion: "threads-v1",
  },
  {
    id: "30000000-0000-4000-a000-000000000003",
    threadId: threads[2].id,
    kind: "status_changed",
    fromStatus: "open",
    toStatus: "blocked",
    at: "2026-07-11T12:00:00.000Z",
    reason: "grounded lifecycle update",
    state: "Atlas blocked",
    evidenceEventIds: [evidence],
    projectorVersion: "threads-v1",
  },
];

let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
};

const all = buildThreadView({ threads, transitions, at: AT });
check(all.contractVersion === 1, "view contract is explicit");
check(all.viewVersion === "thread-view-v1", "view version is explicit");
check(all.count === 6, "all-state view preserves every thread");
check(all.rollup.total === 6, "rollup counts every thread");
check(all.rollup.active === 4, "rollup separates active situations");
check(all.rollup.open === 1 && all.rollup.waiting === 1, "rollup separates open and waiting");
check(all.rollup.blocked === 1 && all.rollup.emerging === 1, "rollup separates blocked and emerging");
check(all.rollup.dormant === 1 && all.rollup.resolved === 1, "rollup separates dormant and resolved");
check(all.rollup.reviewDue === 2, "due review times are counted deterministically");
check(all.rollup.expectedPassed === 1, "passed expected developments are counted");
check(all.rollup.openCommitments === 1, "open thread commitments are counted");

const active = buildThreadView({ threads, transitions, activeOnly: true, at: AT });
check(active.count === 4, "active view excludes dormant and resolved state");
check(active.threads.every((item) => !["dormant", "resolved"].includes(item.status)), "active filter is exact");
check(active.threads[0].status === "blocked", "blocked situations sort first");
check(active.threads[1].status === "waiting", "waiting situations sort before ordinary open state");
check(active.agentText.includes("canonical derived state"), "agent packet states its authority");
check(active.agentText.includes("Inactivity may make a thread dormant"), "agent packet forbids fabricated closure");

const vienna = buildThreadView({ threads, transitions, query: "Vienna pricing", activeOnly: true, at: AT });
check(vienna.count === 1 && vienna.threads[0].title === "Vienna pilot", "query spans title and commitment text");
check(vienna.agentText.includes("Expected next: pricing review by Jul 14"), "agent packet names the expected development");
check(vienna.agentText.includes("1 open commitment"), "agent packet carries linked commitments");
check(vienna.transitions.length === 2, "transitions are scoped to matching threads");
check(vienna.transitions[0].at > vienna.transitions[1].at, "newest transition is returned first");

const karim = buildThreadView({ threads, query: "Karim", activeOnly: true, at: AT });
check(karim.count === 1 && karim.threads[0].title === "Visa application", "participants are searchable");
const waiting = buildThreadView({ threads, status: "waiting", at: AT });
check(waiting.count === 1 && waiting.threads[0].status === "waiting", "status filter is exact");
const routines = buildThreadView({ threads, kind: "routine", at: AT });
check(routines.count === 1 && routines.threads[0].title === "Sunday planning", "kind filter is exact");
const limited = buildThreadView({ threads, limit: 2, at: AT });
check(limited.count === 2, "result limits are bounded");

const miss = buildThreadView({ threads, query: "moon colony", activeOnly: true, at: AT });
check(miss.count === 0, "unrelated queries return an honest miss");
check(miss.agentText.includes("not proof that no related episodic memory exists"), "miss does not overclaim forgetting");
check(threadMatchesQuery(threads[0], "pricing deck"), "commitment terms match a thread");
check(!threadMatchesQuery(threads[0], "embassy response"), "unrelated expected state does not match");
check(sortThreads(threads, AT).map((item) => item.id).join("|") === all.threads.map((item) => item.id).join("|"), "sort order is reusable");
check(
  JSON.stringify(buildThreadView({ threads, transitions, activeOnly: true, at: AT })) === JSON.stringify(active),
  "identical inputs replay byte-for-byte",
);

console.log(`${checks} thread-experience checks passed`);
