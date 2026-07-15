"use client";

import { useMemo, useState } from "react";
import type { ContinuityExperience } from "@/lib/memory/continuity-view";

type Panel = "week" | "month" | "dossier" | "emotions" | "routines" | "anniversaries" | "humor";

const PANELS: Array<{ id: Panel; label: string }> = [
  { id: "week", label: "week" },
  { id: "month", label: "month" },
  { id: "dossier", label: "dossiers" },
  { id: "emotions", label: "feelings" },
  { id: "routines", label: "patterns" },
  { id: "anniversaries", label: "returning" },
  { id: "humor", label: "inside jokes" },
];

function dateLabel(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: new Date(parsed).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function valueLabel(value: { type: string; value: unknown }) {
  if (value.type === "entity" && value.value && typeof value.value === "object" && "label" in value.value) {
    return String(value.value.label);
  }
  return String(value.value);
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/[0.07] bg-white/[0.025] px-6 py-9 text-center text-[13px] text-zinc-600">
      {children}
    </div>
  );
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h3 className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">{children}</h3>
      {typeof count === "number" && (
        <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 font-mono text-[8px] text-zinc-600">
          {count}
        </span>
      )}
    </div>
  );
}

function ConstellationPanel({
  view,
}: {
  view: NonNullable<NonNullable<ContinuityExperience["overview"]>["week"]>;
}) {
  const events = [...view.toldEvents].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
      <section className="rounded-3xl border border-white/[0.08] bg-white/[0.028] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-violet-200/55">
              {view.period === "week" ? "seven days" : "trailing month"}
            </p>
            <h2 className="mt-1 text-[21px] font-light text-zinc-100">
              {dateLabel(view.range.start)} — {dateLabel(view.range.end)}
            </h2>
          </div>
          <div className="flex gap-2">
            {[
              ["tellings", view.toldEvents.length],
              ["people", view.people.length],
              ["changes", view.changes.length],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl bg-white/[0.04] px-3 py-2 text-center ring-1 ring-inset ring-white/[0.05]">
                <p className="text-[17px] font-light tabular-nums text-zinc-300">{value}</p>
                <p className="font-mono text-[7.5px] uppercase tracking-[0.16em] text-zinc-700">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6">
          <SectionTitle count={events.length}>what was told</SectionTitle>
          {events.length ? (
            <div className="relative flex flex-col gap-4 border-l border-white/[0.07] pl-5">
              {events.slice(0, 14).map((event) => (
                <div key={event.id} className="relative">
                  <span className="absolute -left-[22px] top-[6px] size-[5px] rounded-full bg-violet-300/65 shadow-[0_0_9px_rgb(196_181_253/0.35)]" />
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.15em] text-zinc-700">
                    {dateLabel(event.at)}
                  </span>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">{event.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-zinc-600">No telling landed in this range.</p>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <section className="rounded-3xl border border-white/[0.07] bg-white/[0.024] p-5">
          <SectionTitle count={view.unfinishedThreads.length}>still alive</SectionTitle>
          {view.unfinishedThreads.length ? (
            <div className="flex flex-col gap-3">
              {view.unfinishedThreads.slice(0, 8).map((thread) => (
                <div key={thread.id}>
                  <div className="flex items-center gap-2">
                    <span className="size-[5px] rounded-full bg-sky-300/75" />
                    <p className="text-[12.5px] font-medium text-zinc-300">{thread.title}</p>
                    <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.13em] text-zinc-700">
                      {thread.status}
                    </span>
                  </div>
                  <p className="mt-1 pl-3.5 text-[11.5px] leading-relaxed text-zinc-600">
                    {thread.currentState.text}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-zinc-600">No active thread changed here.</p>
          )}
        </section>

        <section className="rounded-3xl border border-white/[0.07] bg-white/[0.024] p-5">
          <SectionTitle count={view.decisions.length}>decisions</SectionTitle>
          {view.decisions.length ? (
            <div className="flex flex-col gap-2.5">
              {view.decisions.slice(0, 8).map((decision) => (
                <p key={decision.eventId} className="text-[12px] leading-relaxed text-zinc-500">
                  {decision.text}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-zinc-600">No structured decision surfaced.</p>
          )}
        </section>

        <section className="rounded-3xl border border-white/[0.07] bg-white/[0.024] p-5">
          <SectionTitle count={view.emotionalEpisodes.length}>felt moments</SectionTitle>
          {view.emotionalEpisodes.length ? (
            <div className="flex flex-col gap-2.5">
              {view.emotionalEpisodes.slice(0, 8).map((episode) => (
                <div key={`${episode.eventId}:${episode.at}`} className="flex items-baseline gap-2">
                  <span className="font-mono text-[8px] text-zinc-700">{dateLabel(episode.at)}</span>
                  <span className="text-[12px] text-zinc-500">{episode.state}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-zinc-600">No direct emotional episode.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function DossierPanel() {
  const [about, setAbout] = useState("");
  const [result, setResult] = useState<ContinuityExperience | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = about.trim();
    if (!query) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/memory/continuity?view=dossier&about=${encodeURIComponent(query)}`);
      const data = (await response.json()) as ContinuityExperience & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "dossier lookup failed");
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "dossier lookup failed");
    } finally {
      setLoading(false);
    }
  };

  const dossier = result?.dossier ?? null;
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={lookup} className="flex flex-col gap-2 sm:flex-row">
        <input
          value={about}
          onChange={(event) => setAbout(event.target.value)}
          placeholder="Layla, Vienna, Project Meridian…"
          aria-label="Person, place, or project"
          className="glass-chip h-11 min-w-0 flex-1 rounded-full px-5 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-white/25"
        />
        <button
          type="submit"
          disabled={loading || !about.trim()}
          className="h-11 rounded-full border border-white/[0.1] bg-white/[0.06] px-5 text-[12px] font-medium text-zinc-300 transition hover:bg-white/[0.1] disabled:opacity-40"
        >
          {loading ? "assembling…" : "open dossier"}
        </button>
      </form>
      {error ? <Empty>{error}</Empty> : !result ? (
        <Empty>A living view of anyone, anywhere, or any project—current truth, history, open threads and promises.</Empty>
      ) : !dossier ? (
        <Empty>No grounded dossier matched “{result.about}”. A loose episodic mention may still exist.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
          <section className="rounded-3xl border border-white/[0.08] bg-white/[0.028] p-6">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-200/55">{dossier.entity.kind}</p>
            <h2 className="mt-1 text-[25px] font-light text-zinc-100">{dossier.entity.label}</h2>
            <p className="mt-2 text-[11px] text-zinc-600">
              last grounded mention {dossier.lastMentionedAt ? dateLabel(dossier.lastMentionedAt) : "unknown"}
            </p>
            <div className="mt-6">
              <SectionTitle count={dossier.currentBeliefs.length}>current truth</SectionTitle>
              <div className="flex flex-col gap-3">
                {dossier.currentBeliefs.slice(0, 12).map((belief) => (
                  <div key={belief.key}>
                    <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-700">
                      {belief.predicate.replace(/[._]+/g, " ")} · {belief.confidence}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-zinc-400">{valueLabel(belief.value)}</p>
                  </div>
                ))}
                {!dossier.currentBeliefs.length && <p className="text-[12px] text-zinc-600">No stable current claim.</p>}
              </div>
            </div>
          </section>
          <div className="flex flex-col gap-4">
            <section className="rounded-3xl border border-white/[0.07] bg-white/[0.024] p-5">
              <SectionTitle count={dossier.activeThreads.length}>active situations</SectionTitle>
              {dossier.activeThreads.length ? dossier.activeThreads.slice(0, 10).map((thread) => (
                <div key={thread.id} className="mb-3 last:mb-0">
                  <div className="flex items-center gap-2 text-[12.5px] text-zinc-300">
                    <span className="size-[5px] rounded-full bg-sky-300/70" />{thread.title}
                    <span className="ml-auto font-mono text-[8px] uppercase text-zinc-700">{thread.status}</span>
                  </div>
                  <p className="mt-1 pl-3.5 text-[11.5px] leading-relaxed text-zinc-600">{thread.currentState.text}</p>
                </div>
              )) : <p className="text-[12px] text-zinc-600">Nothing unfinished is attached.</p>}
            </section>
            <section className="rounded-3xl border border-white/[0.07] bg-white/[0.024] p-5">
              <SectionTitle count={dossier.commitments.length}>open promises</SectionTitle>
              {dossier.commitments.length ? dossier.commitments.slice(0, 10).map((commitment) => (
                <div key={commitment.eventId} className="mb-2.5 flex gap-3 text-[12px] text-zinc-500 last:mb-0">
                  <span className="mt-[6px] size-[4px] shrink-0 rounded-full bg-amber-200/65" />
                  <span className="flex-1">{commitment.content}</span>
                  {commitment.due && <span className="shrink-0 text-[10px] text-zinc-700">{dateLabel(commitment.due)}</span>}
                </div>
              )) : <p className="text-[12px] text-zinc-600">No open commitment.</p>}
            </section>
            <p className="px-2 text-[10.5px] leading-relaxed text-zinc-700">
              {dossier.historicalBeliefs.length} historical or uncertain structured belief{dossier.historicalBeliefs.length === 1 ? "" : "s"} remain inspectable, never silently rewritten.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function EmotionPanel({ view }: { view: NonNullable<NonNullable<ContinuityExperience["overview"]>["emotions"]> }) {
  const episodes = [...view.episodes].reverse();
  return episodes.length ? (
    <div className="rounded-3xl border border-white/[0.08] bg-white/[0.028] p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-rose-200/55">temporary evidence</p>
          <h2 className="mt-1 text-[22px] font-light text-zinc-100">Emotional continuity</h2>
        </div>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 font-mono text-[8.5px] uppercase tracking-[0.15em] text-zinc-500">
          {view.direction}
        </span>
      </div>
      <div className="relative mt-7 flex flex-col gap-5 border-l border-white/[0.08] pl-6">
        {episodes.slice(0, 16).map((episode) => (
          <div key={`${episode.eventId}:${episode.toldAt}`} className="relative">
            <span className="absolute -left-[27px] top-[7px] size-[6px] rounded-full bg-rose-300/65 shadow-[0_0_10px_rgb(253_164_175/0.3)]" />
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-[14px] text-zinc-300">{episode.state}</p>
              <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-700">{episode.confidence}</span>
              <span className="ml-auto text-[10px] text-zinc-700">{dateLabel(episode.validTime?.start ?? episode.toldAt)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-7 text-[11px] leading-relaxed text-zinc-700">Moments, never diagnoses. No episode becomes a permanent trait.</p>
    </div>
  ) : <Empty>There is not enough direct emotional evidence to describe an arc yet.</Empty>;
}

function RoutinePanel({ view }: { view: NonNullable<NonNullable<ContinuityExperience["overview"]>["routines"]> }) {
  if (!view.routines.length && !view.associations.length) {
    return <Empty>No recurring pattern has enough grounded evidence to present yet.</Empty>;
  }
  return (
    <div className="flex flex-col gap-5">
      {!!view.routines.length && (
        <div>
          <SectionTitle count={view.routines.length}>explicit routines</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {view.routines.map((routine) => (
              <article key={`${routine.entity.id}:${routine.pattern}`} className="rounded-3xl border border-white/[0.08] bg-white/[0.028] p-5">
                <div className="flex items-center gap-2">
                  <span className={`size-[6px] rounded-full ${routine.status === "open" ? "bg-emerald-300/70" : "bg-violet-300/65"}`} />
                  <h2 className="text-[14px] font-medium text-zinc-200">{routine.entity.label}</h2>
                  <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-700">{routine.status}</span>
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-zinc-400">{routine.pattern}</p>
                <div className="mt-4 flex items-center gap-3 font-mono text-[8.5px] uppercase tracking-[0.12em] text-zinc-700">
                  <span>{routine.observations} observations</span>
                  <span>{routine.confidence}</span>
                  {routine.lastObservedAt && <span className="ml-auto normal-case tracking-normal">{dateLabel(routine.lastObservedAt)}</span>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {!!view.associations.length && (
        <div>
          <SectionTitle count={view.associations.length}>emerging associations</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {view.associations.map((association) => (
              <article key={association.id} className="rounded-3xl border border-cyan-200/[0.09] bg-cyan-200/[0.025] p-5">
                <div className="flex items-center gap-2">
                  <span className={`size-[6px] rounded-full ${association.status === "active" ? "bg-cyan-300/75" : "bg-zinc-700"}`} />
                  <h2 className="text-[14px] font-medium text-zinc-200">{association.subject.label}</h2>
                  <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-700">{association.status}</span>
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-zinc-400">
                  associated with <span className="text-zinc-300">{association.outcomeValue}</span>
                </p>
                <div className="mt-4 flex items-center gap-3 font-mono text-[8.5px] uppercase tracking-[0.12em] text-zinc-700">
                  <span>{association.observations} episodes</span>
                  <span>{Math.round(association.confidence * 100)}%</span>
                  <span className="ml-auto normal-case tracking-normal">{dateLabel(association.lastObservedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      <p className="text-center text-[10.5px] text-zinc-700">Associations are non-causal hypotheses, never permanent traits. Repetition strengthens them; time and deletion can weaken or remove them.</p>
    </div>
  );
}

function AnniversaryPanel({ view }: { view: NonNullable<NonNullable<ContinuityExperience["overview"]>["anniversaries"]> }) {
  return view.memories.length ? (
    <div className="grid gap-3 sm:grid-cols-2">
      {view.memories.map((memory) => (
        <article key={`${memory.evidenceEventIds[0]}:${memory.storyDate}`} className="relative overflow-hidden rounded-3xl border border-amber-200/[0.1] bg-amber-100/[0.025] p-6">
          <div className="absolute -right-8 -top-8 size-28 rounded-full bg-amber-200/[0.035] blur-xl" />
          <p className="font-mono text-[8.5px] uppercase tracking-[0.19em] text-amber-100/45">{memory.when}</p>
          <p className="mt-3 text-[14px] leading-relaxed text-zinc-300">{memory.text}</p>
          <div className="mt-4 flex items-center justify-between gap-3 text-[10px] text-zinc-700">
            <span>lived {dateLabel(memory.storyDate)}</span>
            <span className="font-mono text-[7.5px] uppercase tracking-[0.12em]">
              {memory.trust ?? "legacy · unclassified"}
            </span>
          </div>
        </article>
      ))}
      <p className="col-span-full mt-2 text-center text-[10.5px] text-zinc-700">Calendar arithmetic only. Proactive surfacing still passes attention and silence.</p>
    </div>
  ) : <Empty>Nothing grounded returns on this exact calendar date.</Empty>;
}

function HumorPanel({ view }: { view: NonNullable<NonNullable<ContinuityExperience["overview"]>["humor"]> }) {
  return view.artifacts.length ? (
    <div className="flex flex-col gap-3">
      {view.repairBlocked && (
        <div className="rounded-2xl border border-red-300/[0.12] bg-red-300/[0.04] px-4 py-3 text-[12px] text-red-100/60">
          Callbacks are blocked until relationship repair is resolved.
        </div>
      )}
      {view.artifacts.map((artifact) => {
        const eligible = view.eligibleArtifactIds.includes(artifact.id);
        return (
          <article key={artifact.id} className="rounded-3xl border border-white/[0.08] bg-white/[0.028] p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`size-[6px] rounded-full ${eligible ? "bg-fuchsia-300/75 shadow-[0_0_10px_rgb(240_171_252/0.3)]" : "bg-zinc-700"}`} />
              <h2 className="text-[14px] font-medium text-zinc-200">{artifact.reference}</h2>
              <span className="rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.13em] text-zinc-600">
                {artifact.status}
              </span>
              {eligible && <span className="font-mono text-[8px] uppercase tracking-[0.13em] text-fuchsia-200/55">attention eligible</span>}
            </div>
            <p className="mt-2 text-[12px] text-zinc-500">{artifact.theme}</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-zinc-700">
              <span>user reuse {artifact.userReuseCount}</span>
              <span>callbacks {artifact.recallUseCount}</span>
              <span>negative {artifact.negativeSignals}</span>
              {artifact.cooldownUntil && <span>cooldown {dateLabel(artifact.cooldownUntil)}</span>}
            </div>
          </article>
        );
      })}
      <p className="mt-2 text-center text-[10.5px] leading-relaxed text-zinc-700">Inventory is not permission. Attention authorizes one transformed callback; repair and serious moments silence it.</p>
    </div>
  ) : <Empty>No joke has become a shared callback yet. A laugh alone is not enough—the user has to make it theirs.</Empty>;
}

export function ContinuityBoard({ data }: { data: ContinuityExperience | null }) {
  const [panel, setPanel] = useState<Panel>("week");
  const overview = data?.overview ?? null;
  const metrics = useMemo(() => overview ? [
    ["week", overview.week.toldEvents.length, "text-violet-200/75"],
    ["live threads", overview.week.unfinishedThreads.length, "text-sky-200/75"],
    ["patterns", overview.routines.routines.length, "text-emerald-200/70"],
    ["returning", overview.anniversaries.memories.length, "text-amber-100/75"],
  ] : [], [overview]);

  return (
    <div className="absolute inset-0 overflow-y-auto pb-24 pt-24">
      <div className="mx-auto flex w-[min(92vw,960px)] flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-light tracking-tight text-zinc-50">Continuity</h1>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-zinc-500">
              The living view—people and projects, what the week meant, feelings that moved, patterns forming, the past returning, and jokes becoming ours.
            </p>
          </div>
          <div className="glass-chip flex max-w-full gap-0.5 overflow-x-auto rounded-full p-0.5">
            {PANELS.map((item) => (
              <button
                key={item.id}
                onClick={() => setPanel(item.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[10.5px] font-medium transition-all ${panel === item.id ? "bg-white/10 text-zinc-100" : "text-zinc-600 hover:text-zinc-300"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {overview && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {metrics.map(([label, value, tone]) => (
              <div key={String(label)} className="glass rounded-2xl px-4 py-3.5">
                <p className={`text-[22px] font-light tabular-nums ${tone}`}>{value}</p>
                <p className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-zinc-700">{label}</p>
              </div>
            ))}
          </div>
        )}

        {!overview ? (
          <p className="text-[13px] text-zinc-600">assembling continuity…</p>
        ) : panel === "week" ? (
          <ConstellationPanel view={overview.week} />
        ) : panel === "month" ? (
          <ConstellationPanel view={overview.month} />
        ) : panel === "dossier" ? (
          <DossierPanel />
        ) : panel === "emotions" ? (
          <EmotionPanel view={overview.emotions} />
        ) : panel === "routines" ? (
          <RoutinePanel view={overview.routines} />
        ) : panel === "anniversaries" ? (
          <AnniversaryPanel view={overview.anniversaries} />
        ) : (
          <HumorPanel view={overview.humor} />
        )}

        <p className="text-center font-mono text-[9px] uppercase tracking-[0.19em] text-zinc-700">
          evidence before interpretation · uncertainty stays alive
        </p>
      </div>
    </div>
  );
}
