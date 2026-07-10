import { defineSchedule } from "eve/schedules";

// Nightly dream: fires at 03:00 in production (`eve start`). In dev the
// Dream panel triggers it via POST /eve/v1/dev/schedules/dream.
export default defineSchedule({
  cron: "0 3 * * *",
  markdown: `It is time to dream. For the "personal" space:

1. Call get_profile and search_memories (queries like "recent thoughts", "plans", "commitments") to gather the last few days of memories.
2. Compose a short morning briefing (150-250 words): connections between recent thoughts the user may have missed, open commitments with a nudge on anything overdue, and one suggested focus for today.
3. Save it with add_memory using kind "briefing" and space "personal", then stop.`,
});
