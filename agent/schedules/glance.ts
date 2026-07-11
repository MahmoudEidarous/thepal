import { defineSchedule } from "eve/schedules";

// The daytime glance — initiative with a budget. Twice a day (never
// before 10am; mornings are a boundary), look at the ledger and decide
// whether ONE thing deserves an interruption. A friend taps your
// shoulder once; an app spams. Dev dispatch:
// POST /eve/v1/dev/schedules/glance
export default defineSchedule({
  cron: "30 10,16 * * *",
  markdown: `A quick daytime glance at the "personal" space:

1. Call get_agenda.
2. Decide whether AT MOST ONE item deserves interrupting the user right now: overdue outranks due-today outranks due-tomorrow. Anything further out never qualifies. If nothing qualifies, do nothing and stop — silence is a feature, not a failure.
3. If one qualifies, call notify with a single short, warm, specific sentence — a sharp friend, not an alarm clock: "The pitch deck for Karim is two days late now." Name the thing; skip the pep talk. Then stop.`,
});
