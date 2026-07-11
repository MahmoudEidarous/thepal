import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { localToday } from "@/lib/envelope";
import { stripHints } from "@/lib/ledger";

// The inner weather. Every memory was stamped with valence and
// intensity at write time — this reads six weeks of those stamps back
// as a seismograph: which days moved the needle, and which way. No
// model in the loop; the envelope already did the feeling.

type Doc = {
  id: string;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

const WINDOW_DAYS = 42;

type DayEntry = { v: number; i: number; id: string; text: string };

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tag = spaceTag(asSpace(url.searchParams.get("space")));
    const today = localToday();

    const listed = await supermemory.documents.list({
      containerTags: [tag],
      limit: 500,
      sort: "createdAt",
      order: "desc",
    });
    const docs = ((listed as { memories?: Doc[] }).memories ?? []).filter(
      (d) =>
        typeof d.metadata?.valence === "number" &&
        typeof d.metadata?.intensity === "number" &&
        d.metadata?.type !== "briefing",
    );

    // day buckets, keyed YYYY-MM-DD. A memory lands on the day its
    // content happened when that day is real and already past; a feeling
    // about the future belongs to the day it was told.
    const byDay = new Map<string, DayEntry[]>();
    for (const d of docs) {
      const story = typeof d.metadata?.storyDate === "string" ? d.metadata.storyDate : "";
      const told = (d.createdAt ?? "").slice(0, 10);
      const day = story.length === 10 && story <= today ? story : told;
      if (!day) continue;
      const list = byDay.get(day) ?? [];
      list.push({
        v: d.metadata!.valence as number,
        i: d.metadata!.intensity as number,
        id: d.id,
        text: stripHints(d.content ?? ""),
      });
      byDay.set(day, list);
    }

    // the series: one point per day, oldest first, quiet days included —
    // silence is real data on a seismograph
    const days: Array<{ date: string; v: number; a: number; n: number }> = [];
    const base = new Date(`${today}T12:00:00`);
    for (let k = WINDOW_DAYS - 1; k >= 0; k--) {
      const dt = new Date(base);
      dt.setDate(dt.getDate() - k);
      const date = dt.toLocaleDateString("en-CA");
      const entries = byDay.get(date) ?? [];
      if (!entries.length) {
        days.push({ date, v: 0, a: 0, n: 0 });
        continue;
      }
      // intensity-weighted valence: one heavy moment outweighs five
      // logistics facts; amplitude is the day's strongest tremor
      let wSum = 0;
      let vSum = 0;
      let a = 0;
      for (const e of entries) {
        const w = 0.3 + 0.7 * e.i;
        wSum += w;
        vSum += e.v * w;
        a = Math.max(a, e.i);
      }
      days.push({
        date,
        v: Math.round((vSum / wSum) * 100) / 100,
        a: Math.round(a * 100) / 100,
        n: entries.length,
      });
    }

    const felt = days.filter((d) => d.n > 0 && d.a > 0);
    const human = (iso: string) =>
      new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });

    // the extremes, each with the memory that made the day
    const signal = (d: (typeof days)[number]) => d.v * (0.3 + 0.7 * d.a);
    const peak = async (dir: 1 | -1) => {
      const day = [...felt].sort((x, y) => (signal(y) - signal(x)) * dir)[0];
      if (!day || signal(day) * dir < 0.08) return null;
      const top = (byDay.get(day.date) ?? [])
        .filter((e) => e.v * dir > 0)
        .sort((x, y) => y.i - x.i)[0];
      // list truncates content — fetch the one memory that made the day
      let why = top?.text ?? "";
      if (top && !why) {
        const got = (await supermemory.documents
          .get(top.id)
          .catch(() => null)) as { content?: string | null } | null;
        why = stripHints(got?.content ?? "");
      }
      return { date: day.date, label: human(day.date), why: why.slice(0, 90) };
    };
    const [brightest, roughest] = await Promise.all([peak(1), peak(-1)]);

    // drift: this week's weighted lean against the fortnight before it
    const lean = (slice: typeof days) => {
      const withFeel = slice.filter((d) => d.n > 0);
      if (!withFeel.length) return null;
      return withFeel.reduce((s, d) => s + signal(d), 0) / withFeel.length;
    };
    const week = lean(days.slice(-7));
    const before = lean(days.slice(-21, -7));
    const drift: "up" | "down" | "steady" =
      week === null || before === null
        ? "steady"
        : week - before > 0.06
          ? "up"
          : before - week > 0.06
            ? "down"
            : "steady";

    // the spoken read — deterministic, honest, two sentences at most
    let spoken: string;
    if (felt.length < 4) {
      spoken =
        "The needle has barely moved — not enough feeling on the record yet to chart real weather.";
    } else {
      const mean = felt.reduce((s, d) => s + signal(d), 0) / felt.length;
      const overall =
        mean > 0.08
          ? "Mostly bright these six weeks"
          : mean < -0.08
            ? "A heavy stretch, these six weeks"
            : "An even keel these six weeks";
      const rough = roughest ? `; roughest around ${roughest.label}` : "";
      const bright = brightest ? `, brightest ${brightest.label}` : "";
      const trend =
        drift === "up"
          ? "This week is trending brighter."
          : drift === "down"
            ? "This week has dimmed a little."
            : "Lately: steady.";
      spoken = `${overall}${rough}${bright}. ${trend}`;
    }

    return Response.json({ today, days, drift, brightest, roughest, spoken });
  } catch (err) {
    return apiError(err);
  }
}
