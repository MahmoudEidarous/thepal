"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import type { Space } from "@/lib/spaces";
import { VoiceOrb, type OrbState } from "./voice-orb";

type Line = { role: "user" | "agent"; text: string };
type Activity = { id: number; label: string };
type PendingForget = {
  about: string;
  preview: string[];
  resolve: (approved: boolean) => void;
};

type Engine = "online" | "offline" | "checking";

async function postJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${path} failed (${res.status})`);
  return data;
}

function VoiceCore({
  space,
  onSpaceChange,
  engine,
}: {
  space: Space;
  onSpaceChange: (s: Space) => void;
  engine: Engine;
}) {
  const spaceRef = useRef(space);
  const [lines, setLines] = useState<Line[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [pending, setPending] = useState<PendingForget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [greeting, setGreeting] = useState("Hello.");
  const seq = useRef(0);
  const spaceSetByTool = useRef(false);
  const levelHost = useRef<HTMLDivElement | null>(null);

  const conversation = useConversation({
    onMessage: ({ message, role }) =>
      setLines((l) => [...l.slice(-30), { role, text: message }]),
    onError: (message) => setError(typeof message === "string" ? message : "Connection error"),
  });
  const { status, isSpeaking } = conversation;
  const connected = status === "connected";

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 5 ? "Still up?" : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.");
  }, []);

  useEffect(() => {
    spaceRef.current = space;
  }, [space]);

  // Tell the live agent when the user changes space by hand (clicks a pill).
  useEffect(() => {
    if (spaceSetByTool.current) {
      spaceSetByTool.current = false;
      return;
    }
    if (connected) {
      conversation.sendContextualUpdate(
        `The user switched the app to the ${space} space. Memory tools now act on ${space}.`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space]);

  // Audio-reactive orb: input volume while listening, output while speaking.
  useEffect(() => {
    const host = levelHost.current;
    if (!host) return;
    if (!connected) {
      host.style.setProperty("--lvl", "0");
      return;
    }
    let raf = 0;
    const tick = () => {
      let lvl = 0;
      try {
        lvl = isSpeaking ? conversation.getOutputVolume() : conversation.getInputVolume();
      } catch {
        /* audio graph not ready yet */
      }
      host.style.setProperty("--lvl", String(Math.min(1, lvl * 2.2)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, isSpeaking]);

  // Every tool the agent runs shows up as a visible chip while it works.
  // Tools never throw — a thrown client tool tears down the whole session,
  // so failures are returned to the agent as text it can speak about.
  const track = useCallback(async (label: string, fn: () => Promise<string>): Promise<string> => {
    const id = ++seq.current;
    setActivity((a) => [...a, { id, label }]);
    try {
      return await fn();
    } catch (e) {
      return `Tool failed: ${e instanceof Error ? e.message : "unknown error"}. Tell the user the memory engine had a problem, then continue.`;
    } finally {
      setActivity((a) => a.filter((x) => x.id !== id));
    }
  }, []);

  async function wake() {
    if (connected || status === "connecting") {
      void conversation.endSession();
      return;
    }
    setError(null);
    setLines([]);
    try {
      const res = await fetch("/api/voice/signed-url");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "couldn't reach ElevenLabs");
      conversation.startSession({
        signedUrl: data.signedUrl,
        connectionType: "websocket",
        // ?text mode: same agent, same tools, no microphone — used for
        // debugging and as a quiet-environment fallback.
        textOnly: new URLSearchParams(window.location.search).has("text"),
        dynamicVariables: {
          space: spaceRef.current,
          today: new Date().toISOString().slice(0, 10),
          weekday: new Date().toLocaleDateString("en-US", { weekday: "long" }),
        },
        clientTools: {
          search_memories: ({ query }: { query: string }) =>
            track("searching memories", async () => {
              const data = await postJson("/api/recall", {
                q: query,
                space: spaceRef.current,
                limit: 6,
              });
              const hits = (data.results ?? [])
                .map((r: { memory?: string; chunk?: string }) => r.memory ?? r.chunk)
                .filter(Boolean);
              return hits.length
                ? `Found ${hits.length} memories:\n${hits.map((h: string) => `- ${h}`).join("\n")}`
                : "No memories found for that.";
            }),
          get_profile: () =>
            track("reading profile", async () => {
              const res = await fetch(`/api/profile?space=${spaceRef.current}`);
              const data = await res.json();
              const stat = data.profile?.static ?? [];
              const dyn = data.profile?.dynamic ?? [];
              if (!stat.length && !dyn.length) return "The profile is empty so far.";
              return `Stable facts:\n${stat.join("\n")}\n\nRight now:\n${dyn.join("\n")}`;
            }),
          add_memory: ({ content, kind, due }: { content: string; kind?: string; due?: string }) =>
            track("remembering", async () => {
              await postJson("/api/capture", {
                content,
                kind: kind ?? "memory",
                due,
                space: spaceRef.current,
                source: "recall-voice",
              });
              return "Saved. It will appear in the feed once extracted.";
            }),
          preview_forget: ({ about }: { about: string }) =>
            track("previewing forget", async () => {
              const data = await postJson("/api/forget", {
                query: about,
                space: spaceRef.current,
                dryRun: true,
              });
              return data.count
                ? `${data.count} memories would be deleted:\n${data.memories.map((m: string) => `- ${m}`).join("\n")}`
                : "Nothing matches that.";
            }),
          execute_forget: ({ about }: { about: string }) =>
            track("awaiting approval", async () => {
              const preview = await postJson("/api/forget", {
                query: about,
                space: spaceRef.current,
                dryRun: true,
              });
              if (!preview.count) return "Nothing matches that — nothing to delete.";
              const approved = await new Promise<boolean>((resolve) =>
                setPending({ about, preview: preview.memories ?? [], resolve }),
              );
              setPending(null);
              if (!approved) return "The user denied the deletion on screen. Nothing was deleted.";
              const res = await postJson("/api/forget", {
                query: about,
                space: spaceRef.current,
                dryRun: false,
              });
              return `Deleted ${res.count} memories. They are gone.`;
            }),
          get_briefing: () =>
            track("fetching briefing", async () => {
              const res = await fetch("/api/briefings?space=personal");
              const data = await res.json();
              const latest = data.briefings?.[0];
              return latest?.content ?? "No briefing yet — I haven't dreamed since we last spoke.";
            }),
          switch_space: ({ space: target }: { space: string }) =>
            track(`switching to ${target}`, async () => {
              if (target !== "personal" && target !== "work" && target !== "health") {
                return "Unknown space. The spaces are personal, work, and health.";
              }
              spaceSetByTool.current = true;
              onSpaceChange(target);
              return `Switched to the ${target} space.`;
            }),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't start the session");
    }
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || !connected) return;
    conversation.sendUserMessage(t);
    setLines((l) => [...l.slice(-30), { role: "user", text: t }]);
    setText("");
  }

  const orbState: OrbState =
    status === "connecting"
      ? "connecting"
      : !connected
        ? "idle"
        : activity.length > 0
          ? "thinking"
          : isSpeaking
            ? "speaking"
            : "listening";

  const lastAgent = [...lines].reverse().find((l) => l.role === "agent");
  const lastUser = [...lines].reverse().find((l) => l.role === "user");

  return (
    <section ref={levelHost} className="card relative flex flex-col items-center px-6 pb-6 pt-10 text-center">
      <VoiceOrb state={orbState} onClick={wake} />

      <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
        {orbState === "idle"
          ? "tap the orb to talk"
          : orbState === "connecting"
            ? "connecting…"
            : activity.length > 0
              ? activity[activity.length - 1].label + "…"
              : orbState}
      </p>

      {!connected && !error && (
        <div className="mt-4 max-w-md">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
            {greeting} <span className="text-zinc-400">Just talk.</span>
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-400">
            Recall listens, remembers what matters, recalls what you&apos;ve forgotten, and
            forgets only with your approval — every memory stays on this machine.
          </p>
        </div>
      )}

      {connected && (
        <div className="mt-4 flex min-h-[76px] max-w-lg flex-col items-center gap-2">
          {lastUser && (
            <p className="text-[13px] leading-relaxed text-zinc-400">“{lastUser.text}”</p>
          )}
          {lastAgent && (
            <p className="animate-rise text-[16.5px] leading-relaxed text-zinc-800">
              {lastAgent.text}
            </p>
          )}
        </div>
      )}

      {activity.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {activity.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono text-[11px] tracking-wide text-amber-700"
            >
              <span className="size-[5px] animate-pulse rounded-full bg-amber-400" />
              {a.label}
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-[13px] text-red-600">{error}</p>
      )}
      {engine === "offline" && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-[13px] text-amber-700">
          The memory engine is offline — the voice can talk but can&apos;t reach your memories.
        </p>
      )}

      {connected && (
        <div className="mt-6 flex w-full max-w-lg items-center gap-2 border-t border-black/[0.05] pt-4">
          <button
            onClick={() => conversation.setMuted(!conversation.isMuted)}
            className={
              "pill shrink-0 border " +
              (conversation.isMuted
                ? "border-red-200 bg-red-50 text-red-600"
                : "border-black/[0.08] bg-white text-zinc-600 hover:border-black/[0.16]")
            }
          >
            {conversation.isMuted ? "mic off" : "mic on"}
          </button>
          <form onSubmit={sendTyped} className="flex min-w-0 flex-1 items-center gap-2">
            <input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                conversation.sendUserActivity();
              }}
              placeholder="or type it…"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-zinc-900 outline-none placeholder:text-zinc-300"
            />
          </form>
          <button
            onClick={() => void conversation.endSession()}
            className="pill shrink-0 border border-black/[0.08] bg-white text-zinc-600 hover:border-black/[0.16]"
          >
            end
          </button>
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-6 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-md rounded-2xl border border-red-100 bg-white p-6 text-left shadow-2xl">
            <p className="text-[15px] font-semibold text-zinc-900">
              Forget {pending.preview.length} {pending.preview.length === 1 ? "memory" : "memories"}?
            </p>
            <p className="mt-1 text-[13px] text-zinc-500">
              Recall wants to permanently delete everything about “{pending.about}”. This cannot be
              undone.
            </p>
            <div className="mt-4 flex max-h-48 flex-col gap-1.5 overflow-y-auto border-l-2 border-red-100 pl-3.5">
              {pending.preview.map((m, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-zinc-500 line-through decoration-red-300">
                  {m}
                </p>
              ))}
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => pending.resolve(true)}
                className="pill bg-red-600 px-5 py-2 text-white hover:opacity-85"
              >
                Forget them
              </button>
              <button
                onClick={() => pending.resolve(false)}
                className="pill border border-black/[0.1] bg-white text-zinc-600 hover:border-black/[0.2]"
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function VoicePanel(props: {
  space: Space;
  onSpaceChange: (s: Space) => void;
  engine: Engine;
}) {
  return (
    <ConversationProvider>
      <VoiceCore {...props} />
    </ConversationProvider>
  );
}
