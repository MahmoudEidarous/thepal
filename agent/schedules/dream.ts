import { defineSchedule } from "eve/schedules";

// Night Shift. The Writer envelopes memories as they arrive all day;
// this is the Editor — it re-reads what the day wrote, reconciles the
// ledger, and leaves a briefing on the pillow. Fires at 03:00 in
// production (`eve start`); in dev the Dream panel triggers it via
// POST /eve/v1/dev/schedules/dream.
export default defineSchedule({
  cron: "0 3 * * *",
  markdown: `It is time to dream. You are the night editor of the user's memory. For the "personal" space:

1. Ground yourself first: call get_agenda — its response carries today's real date and weekday, and that is the ONLY source of truth for what day it is. A briefing that says "it's Sunday" on a Saturday burns trust.
2. Read the day itself: call get_recent — it returns everything captured in the last 36 hours, newest first with told-times, PLUS last night's briefing. This is your primary material. Use get_profile for stable context and search_memories only to chase questions the day raises (a name you don't know, a thread that needs history).
3. Reconcile before you write:
   - Open commitments: anything overdue or due in the next two days gets named with its date. Anything that memories suggest was already finished, say so plainly so the user can confirm it closed.
   - Contradictions: every memory carries when it was told — the LATEST telling is the current truth. Point at the newer one and note what it replaced.
   - Impressions: treat anything that reads as a mood or inner state as tentative — "you sounded", "you seemed" — never as settled fact, and let stale ones fade rather than repeating them night after night.
   - Last night's briefing is in your hands: do not repeat its insights — advance them, close them, or drop them. A briefing that says the same thing two mornings running is noise.
4. Compose the morning briefing (150-250 words), weighted by what actually matters: high-salience memories first, trivia not at all. Connections between recent thoughts the user may have missed, the ledger's honest state, and one suggested focus for today.
5. End the briefing with exactly one line in this form, on its own line, nothing after it:
   Focus: <one short spoken sentence — the single thing today should be about>
6. Save it with add_memory using kind "briefing" and space "personal", then stop.`,
});
