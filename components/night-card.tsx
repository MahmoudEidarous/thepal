"use client";

import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";

type Briefing = { id: string; content: string; createdAt?: string };
type AgendaItem = {
  id: string;
  content: string;
  due: string | null;
  overdue: boolean;
  dueToday: boolean;
};

// The Night Editor's work, surfaced: a fresh briefing appears here in
// the morning with the ledger items that need a decision — close them
// with one tap, or dismiss the card and it stays gone for that night.
export function NightCard() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [urgent, setUrgent] = useState<AgendaItem[]>([]);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [b, a] = await Promise.all([
      fetch("/api/briefings").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/agenda").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const latest: Briefing | undefined = b?.briefings?.[0];
    const age = latest?.createdAt
      ? Date.now() - new Date(latest.createdAt).getTime()
      : Infinity;
    if (latest && age < 20 * 3600_000) {
      setBriefing(latest);
      setVisible(localStorage.getItem("recall-seen-briefing") !== latest.id);
    }
    // self-healing dream: the cron only fires while the runtime is up —
    // a laptop asleep at 3am must not mean a morning with no briefing.
    // If the newest briefing has gone stale, dream now (at most once
    // per 6h, fire-and-forget).
    if (age > 26 * 3600_000) {
      const last = Number(localStorage.getItem("recall-autodream") ?? 0);
      if (Date.now() - last > 6 * 3600_000) {
        localStorage.setItem("recall-autodream", String(Date.now()));
        void fetch("/eve/v1/dev/schedules/dream", { method: "POST" }).catch(() => {});
      }
    }
    // self-healing glance, same disease, same cure: its cron (10:30,
    // 16:30) never fires in dev. Once per window per day; the glance
    // itself decides whether anything deserves a notification, and the
    // windows already respect the no-mornings boundary.
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const win = mins >= 16 * 60 + 30 ? "pm" : mins >= 10 * 60 + 30 ? "am" : null;
    if (win) {
      const key = `${now.toLocaleDateString("en-CA")}-${win}`;
      if (localStorage.getItem("recall-autoglance") !== key) {
        localStorage.setItem("recall-autoglance", key);
        void fetch("/eve/v1/dev/schedules/glance", { method: "POST" }).catch(() => {});
      }
    }
    setUrgent(
      (((a?.commitments ?? []) as AgendaItem[]) || [])
        .filter((c) => c.overdue || c.dueToday)
        .slice(0, 3),
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state lands after await, no cascade
    void load();
  }, [load]);

  if (!briefing || !visible) return null;

  const focus = briefing.content.match(/^\s*Focus:\s*(.+?)\s*$/im)?.[1];
  const body = briefing.content.replace(/^\s*Focus:.*$/im, "").trim();

  function dismiss() {
    if (briefing) localStorage.setItem("recall-seen-briefing", briefing.id);
    setVisible(false);
  }

  async function closeItem(id: string) {
    setClosing(id);
    await fetch("/api/agenda/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    setUrgent((u) => u.filter((x) => x.id !== id));
    setClosing(null);
  }

  return (
    <aside className="glass animate-rise absolute bottom-7 left-6 z-30 max-h-[46dvh] w-[min(88vw,370px)] overflow-y-auto rounded-3xl p-5">
      <div className="flex items-center gap-2">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="text-indigo-300/90"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-indigo-200/80">
          while you slept
        </span>
        <span className="font-mono text-[9.5px] tabular-nums text-zinc-600">
          {briefing.createdAt ? timeAgo(briefing.createdAt) : ""}
        </span>
        <button
          onClick={dismiss}
          aria-label="Dismiss briefing"
          className="-mr-1 ml-auto px-1 text-[13px] leading-none text-zinc-500 transition-colors hover:text-zinc-200"
        >
          ✕
        </button>
      </div>

      {focus && (
        <p className="mt-3 text-[14px] font-medium leading-relaxed text-zinc-100">{focus}</p>
      )}
      <p
        className={
          "mt-2 text-[12.5px] leading-relaxed text-zinc-400 " +
          (expanded ? "" : "line-clamp-4")
        }
      >
        {body}
      </p>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-300"
      >
        {expanded ? "less" : "the whole note"}
      </button>

      {urgent.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5 border-t border-white/[0.07] pt-3">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-600">
            needs a decision
          </p>
          {urgent.map((c) => (
            <div
              key={c.id}
              className={
                "flex items-center gap-2.5 transition-opacity duration-300 " +
                (closing === c.id ? "opacity-30" : "")
              }
            >
              <button
                onClick={() => closeItem(c.id)}
                disabled={closing === c.id}
                aria-label="Mark done"
                title="Done"
                className="group grid size-[17px] shrink-0 place-items-center rounded-full border border-white/25 transition-all hover:border-emerald-300/80 hover:bg-emerald-300/15"
              >
                <span className="text-[9px] leading-none text-emerald-300 opacity-0 transition-opacity group-hover:opacity-100">
                  ✓
                </span>
              </button>
              <p className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-300">{c.content}</p>
              <span
                className={
                  "shrink-0 font-mono text-[9.5px] " +
                  (c.overdue ? "text-red-300/90" : "text-amber-200/90")
                }
              >
                {c.overdue ? "overdue" : "today"}
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
