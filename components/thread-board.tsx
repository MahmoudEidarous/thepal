"use client";

import { useMemo, useState } from "react";
import { timeAgo } from "@/lib/format";

export type ThreadBoardData = {
  count: number;
  rollup: {
    total: number;
    active: number;
    open: number;
    waiting: number;
    blocked: number;
    emerging: number;
    dormant: number;
    resolved: number;
    reviewDue: number;
    expectedPassed: number;
    openCommitments: number;
  };
  threads: Array<{
    id: string;
    title: string;
    kind: string;
    status: "open" | "waiting" | "blocked" | "emerging" | "dormant" | "resolved";
    currentState: { text: string; confidence: string };
    participants: Array<{ id: string; label: string; kind: string }>;
    commitments: Array<{
      eventId: string;
      content: string;
      due: string | null;
      status: "open" | "done" | "cancelled" | "superseded";
    }>;
    expectedNext: {
      event: string;
      by: { start: string; end: string | null; precision: string } | null;
    } | null;
    lastMeaningfulChangeAt: string;
    nextReviewAt: string | null;
    resolution: { reason: string; resolvedAt: string } | null;
    confidence: string;
  }>;
  transitions?: Array<{
    id: string;
    threadId: string;
    kind: string;
    fromStatus: string | null;
    toStatus: string;
    at: string;
    reason: string;
    state: string;
  }>;
};

const ACTIVE = new Set(["open", "waiting", "blocked", "emerging"]);
const STATUS_STYLE: Record<string, { dot: string; badge: string; label: string }> = {
  blocked: {
    dot: "bg-red-300 shadow-[0_0_12px_2px_rgb(252_165_165/0.35)]",
    badge: "border-red-300/15 bg-red-300/[0.07] text-red-200/80",
    label: "blocked",
  },
  waiting: {
    dot: "bg-amber-200 shadow-[0_0_12px_2px_rgb(253_230_138/0.3)]",
    badge: "border-amber-200/15 bg-amber-200/[0.06] text-amber-100/75",
    label: "waiting",
  },
  open: {
    dot: "bg-sky-300 shadow-[0_0_12px_2px_rgb(125_211_252/0.28)]",
    badge: "border-sky-300/15 bg-sky-300/[0.06] text-sky-100/75",
    label: "in motion",
  },
  emerging: {
    dot: "bg-violet-300 shadow-[0_0_12px_2px_rgb(196_181_253/0.25)]",
    badge: "border-violet-300/15 bg-violet-300/[0.06] text-violet-100/70",
    label: "emerging",
  },
  dormant: {
    dot: "bg-zinc-600",
    badge: "border-white/[0.07] bg-white/[0.03] text-zinc-500",
    label: "quiet",
  },
  resolved: {
    dot: "bg-emerald-300/70",
    badge: "border-emerald-300/12 bg-emerald-300/[0.05] text-emerald-200/60",
    label: "closed",
  },
};

function dateOnly(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: new Date(parsed).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function dueTone(value: string) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "text-zinc-500";
  const delta = at - Date.now();
  if (delta < 0) return "text-red-200/80";
  if (delta < 3 * 86_400_000) return "text-amber-100/75";
  return "text-zinc-400";
}

export function ThreadBoard({ data }: { data: ThreadBoardData | null }) {
  const [scope, setScope] = useState<"active" | "all">("active");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.threads ?? []).filter((thread) => {
      if (scope === "active" && !ACTIVE.has(thread.status)) return false;
      if (!needle) return true;
      return [
        thread.title,
        thread.kind,
        thread.status,
        thread.currentState.text,
        thread.expectedNext?.event ?? "",
        ...thread.participants.map((participant) => participant.label),
        ...thread.commitments.map((commitment) => commitment.content),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data, query, scope]);

  return (
    <div className="absolute inset-0 overflow-y-auto pb-24 pt-24">
      <div className="mx-auto flex w-[min(92vw,820px)] flex-col gap-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-light tracking-tight text-zinc-50">Life threads</h1>
            <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-zinc-500">
              Situations still in motion—what changed, what you&apos;re waiting for, and what should happen next.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="glass-chip flex items-center rounded-full p-0.5">
              {(["active", "all"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setScope(value)}
                  className={
                    "rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-all " +
                    (scope === value
                      ? "bg-white/10 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-200")
                  }
                >
                  {value}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="find a situation"
              className="glass-chip h-9 w-44 rounded-full px-4 text-[13px] text-zinc-100 transition-all placeholder:text-zinc-600 focus:border-white/25"
            />
          </div>
        </div>

        {data && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              ["in motion", data.rollup.active, "text-sky-200/80"],
              ["waiting", data.rollup.waiting, "text-amber-100/80"],
              ["blocked", data.rollup.blocked, "text-red-200/80"],
              ["expected passed", data.rollup.expectedPassed, "text-violet-200/75"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className="glass rounded-2xl px-4 py-3.5">
                <p className={`text-[22px] font-light tabular-nums ${tone}`}>{value}</p>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">
                  {label}
                </p>
              </div>
            ))}
          </div>
        )}

        {!data ? (
          <p className="text-[13px] text-zinc-600">following the open threads…</p>
        ) : shown.length === 0 ? (
          <div className="glass rounded-3xl p-8 text-center">
            <p className="text-[15px] font-light text-zinc-200">
              {query ? "Nothing matches that situation." : "Nothing is asking to be followed right now."}
            </p>
            <p className="mt-1.5 text-[12.5px] text-zinc-500">
              A quiet thread may be dormant. Quiet never means finished.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map((thread) => {
              const style = STATUS_STYLE[thread.status] ?? STATUS_STYLE.open;
              const openCommitments = thread.commitments.filter((item) => item.status === "open");
              const threadTransitions = (data.transitions ?? []).filter(
                (transition) => transition.threadId === thread.id,
              );
              const isExpanded = expanded === thread.id;
              return (
                <article
                  key={thread.id}
                  className="overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.028] transition-all hover:border-white/[0.14] hover:bg-white/[0.038]"
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : thread.id)}
                    className="w-full px-5 py-4 text-left sm:px-6 sm:py-5"
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-start gap-3.5">
                      <span className={`mt-[7px] size-[7px] shrink-0 rounded-full ${style.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-[16px] font-medium tracking-[-0.01em] text-zinc-100">
                            {thread.title}
                          </h2>
                          <span
                            className={`rounded-full border px-2 py-[3px] font-mono text-[8.5px] uppercase tracking-[0.15em] ${style.badge}`}
                          >
                            {style.label}
                          </span>
                          <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">
                            {thread.kind}
                          </span>
                          <span className="ml-auto shrink-0 text-[10.5px] text-zinc-600">
                            {timeAgo(thread.lastMeaningfulChangeAt)}
                          </span>
                        </div>
                        <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-400">
                          {thread.currentState.text}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                          {thread.expectedNext && (
                            <span className="text-[11.5px] text-zinc-500">
                              <span className="mr-1.5 font-mono text-[8.5px] uppercase tracking-[0.17em] text-violet-200/55">
                                next
                              </span>
                              {thread.expectedNext.event}
                              {thread.expectedNext.by?.start && (
                                <span className={`ml-1.5 ${dueTone(thread.expectedNext.by.start)}`}>
                                  {dateOnly(thread.expectedNext.by.start)}
                                </span>
                              )}
                            </span>
                          )}
                          {openCommitments.length > 0 && (
                            <span className="font-mono text-[9.5px] tracking-[0.08em] text-amber-100/55">
                              {openCommitments.length} open promise{openCommitments.length === 1 ? "" : "s"}
                            </span>
                          )}
                          {thread.confidence === "tentative" && (
                            <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-violet-200/50">
                              held loosely
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="mt-0.5 shrink-0 text-[12px] text-zinc-600">
                        {isExpanded ? "−" : "+"}
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="grid gap-6 border-t border-white/[0.06] px-6 py-5 sm:grid-cols-2">
                      <div className="flex flex-col gap-5">
                        {openCommitments.length > 0 && (
                          <section>
                            <h3 className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">
                              still owed
                            </h3>
                            <div className="mt-2.5 flex flex-col gap-2">
                              {openCommitments.map((commitment, index) => (
                                <div key={`${commitment.eventId}:${commitment.content}:${commitment.due ?? ""}:${index}`} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-zinc-400">
                                  <span className="mt-[7px] size-[5px] shrink-0 rounded-full bg-amber-200/70" />
                                  <span className="flex-1">{commitment.content}</span>
                                  {commitment.due && (
                                    <span className={`shrink-0 text-[10.5px] ${dueTone(commitment.due)}`}>
                                      {dateOnly(commitment.due)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                        {thread.participants.length > 0 && (
                          <section>
                            <h3 className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">
                              connected
                            </h3>
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {thread.participants.slice(0, 10).map((participant) => (
                                <span key={participant.id} className="rounded-full bg-white/[0.045] px-2.5 py-1 text-[10.5px] text-zinc-500 ring-1 ring-inset ring-white/[0.06]">
                                  {participant.label}
                                </span>
                              ))}
                            </div>
                          </section>
                        )}
                      </div>

                      <section>
                        <h3 className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">
                          how it moved
                        </h3>
                        {threadTransitions.length ? (
                          <div className="relative mt-3 flex flex-col gap-3 border-l border-white/[0.07] pl-4">
                            {threadTransitions.slice(0, 8).map((transition) => (
                              <div key={transition.id} className="relative">
                                <span className="absolute -left-[18.5px] top-[6px] size-[5px] rounded-full bg-zinc-500" />
                                <div className="flex items-baseline gap-2">
                                  <span className="font-mono text-[8.5px] uppercase tracking-[0.15em] text-zinc-500">
                                    {transition.toStatus}
                                  </span>
                                  <span className="text-[9.5px] text-zinc-700">{dateOnly(transition.at)}</span>
                                </div>
                                <p className="mt-0.5 text-[11.5px] leading-relaxed text-zinc-500">
                                  {transition.state}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2.5 text-[11.5px] text-zinc-600">No transition history yet.</p>
                        )}
                      </section>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <p className="text-center font-mono text-[9px] uppercase tracking-[0.19em] text-zinc-700">
          built from evidence · dormant is not resolved
        </p>
      </div>
    </div>
  );
}
