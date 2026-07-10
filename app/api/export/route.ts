import { supermemory, smPost, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { localToday } from "@/lib/envelope";
import { openCommitments, pinned, stripHints } from "@/lib/ledger";

type EntriesResponse = {
  memoryEntries: Array<{
    id: string;
    memory: string;
    version: number;
    isLatest: boolean;
    isForgotten: boolean;
    isStatic: boolean;
    isInference: boolean;
    updatedAt: string;
    history: Array<{ memory: string; version: number; createdAt: string }>;
  }>;
};

// Own your brain: everything Recall knows, as one Markdown file that
// drops straight into an Obsidian vault. Local-first with an exit door.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tag = spaceTag(asSpace(url.searchParams.get("space")));
    const today = localToday();

    const [profile, entriesRes, commitments, boundaries] = await Promise.all([
      supermemory.profile({ containerTag: tag }) as Promise<{
        profile?: { static?: string[]; dynamic?: string[] };
      }>,
      smPost<EntriesResponse>("/v4/memories/list", { containerTags: [tag], limit: 200 }),
      openCommitments(tag),
      pinned(tag),
    ]);

    const entries = (entriesRes.memoryEntries ?? []).filter(
      (e) => e.isLatest && !e.isForgotten,
    );

    const lines: string[] = [
      `# Recall — brain export`,
      ``,
      `> exported ${today} · ${entries.length} memories · stored on this machine`,
      ``,
    ];

    const stat = profile.profile?.static ?? [];
    const dyn = profile.profile?.dynamic ?? [];
    if (stat.length || dyn.length) {
      lines.push(`## Who I am`, ``);
      stat.forEach((f) => lines.push(`- ${f}`));
      if (dyn.length) {
        lines.push(``, `### Right now`, ``);
        dyn.forEach((f) => lines.push(`- ${f}`));
      }
      lines.push(``);
    }

    if (boundaries.length) {
      lines.push(`## Boundaries & safety`, ``);
      boundaries.forEach((b) => lines.push(`- ${b}`));
      lines.push(``);
    }

    if (commitments.length) {
      lines.push(`## Open commitments`, ``);
      commitments.forEach((c) =>
        lines.push(`- [ ] ${c.content}${c.due ? ` — due ${c.due}` : ""}`),
      );
      lines.push(``);
    }

    lines.push(`## Memories`, ``);
    for (const e of entries) {
      const kind = e.isInference ? "inferred" : e.isStatic ? "stable" : "memory";
      lines.push(`- ${stripHints(e.memory)} *(${kind}${e.version > 1 ? `, v${e.version}` : ""})*`);
      for (const h of (e.history ?? []).slice().sort((a, b) => b.version - a.version)) {
        lines.push(`    - ~~${stripHints(h.memory)}~~ *(v${h.version})*`);
      }
    }
    lines.push(``);

    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="recall-brain-${today}.md"`,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
