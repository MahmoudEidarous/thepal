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
  const isSpeakingRef = useRef(false);

  const conversation = useConversation({
    onMessage: ({ message, role }) =>
      setLines((l) => [...l.slice(-30), { role, text: message }]),
    onError: (message) => setError(typeof message === "string" ? message : "Connection error"),
  });
  const { status, isSpeaking } = conversation;
  const connected = status === "connected";
  isSpeakingRef.current = isSpeaking;

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 5 ? "Still up?" : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.");
  }, []);

  useEffect(() => {
    spaceRef.current = space;
  }, [space]);

  // Tell the live agent when the user changes space by hand.
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

  const getLevel = useCallback(() => {
    try {
      return isSpeakingRef.current
        ? conversation.getOutputVolume()
        : conversation.getInputVolume();
    } catch {
      return 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every tool the agent runs shows up as visible activity while it works.
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
    <section className="relative flex min-h-[calc(100dvh-11rem)] flex-col items-center justify-center py-10 text-center">
      <VoiceOrb state={orbState} getLevel={getLevel} onClick={wake} />

      <p className="mt-2 h-4 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
        {orbState === "idle"
          ? ""
          : orbState === "connecting"
            ? "waking"
            : activity.length > 0
              ? activity[activity.length - 1].label
              : orbState}
      </p>

      {!connected && (
        <div className="mt-6 max-w-xl">
          <h1 className="text-[clamp(28px,4.5vw,40px)] font-semibold leading-[1.1] tracking-[-0.02em] text-zinc-900">
            {greeting}
            <span className="text-zinc-400"> Just talk.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-zinc-500">
            Recall listens, remembers what matters, and forgets only with your
            approval. Every memory stays on this machine.
          </p>
          <button
            onClick={wake}
            className="mt-8 rounded-full bg-zinc-900 px-7 py-3 text-[14px] font-medium text-white transition-all hover:bg-zinc-700 hover:shadow-[0_8px_30px_-8px_rgb(37_99_235/0.5)]"
          >
            Start talking
          </button>
        </div>
      )}

      {connected && (
        <div className="mt-6 flex min-h-[96px] w-full max-w-xl flex-col items-center gap-3 px-4">
          {lastUser && (
            <p className="text-[13px] leading-relaxed text-zinc-400">{lastUser.text}</p>
          )}
          {lastAgent && (
            <p className="animate-rise text-[18px] leading-relaxed tracking-[-0.01em] text-zinc-800">
              {lastAgent.text}
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-5 text-[13px] text-red-500">{error}</p>
      )}
      {engine === "offline" && (
        <p className="mt-5 text-[13px] text-amber-600">
          The memory engine is offline — the voice can talk but can&apos;t reach your memories.
        </p>
      )}

      {connected && (
        <div className="mt-8 flex w-full max-w-md items-center justify-center gap-6">
          <button
            onClick={() => conversation.setMuted(!conversation.isMuted)}
            className={
              "text-[13px] font-medium transition-colors " +
              (conversation.isMuted
                ? "text-red-500 hover:text-red-600"
                : "text-zinc-400 hover:text-zinc-700")
            }
          >
            {conversation.isMuted ? "unmute" : "mute"}
          </button>
          <form onSubmit={sendTyped} className="min-w-0 flex-1">
            <input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                conversation.sendUserActivity();
              }}
              placeholder="or type it"
              className="w-full border-b border-black/[0.08] bg-transparent pb-1 text-center text-[14px] text-zinc-800 outline-none transition-colors placeholder:text-zinc-300 focus:border-black/[0.25]"
            />
          </form>
          <button
            onClick={() => void conversation.endSession()}
            className="text-[13px] font-medium text-zinc-400 transition-colors hover:text-zinc-700"
          >
            end
          </button>
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 p-6 backdrop-blur-md">
          <div className="animate-rise w-full max-w-md rounded-2xl border border-black/[0.06] bg-white p-7 text-left shadow-[0_24px_80px_-24px_rgb(0_0_0/0.25)]">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-red-500">
              approval required
            </p>
            <p className="mt-2 text-[17px] font-semibold tracking-tight text-zinc-900">
              Forget {pending.preview.length}{" "}
              {pending.preview.length === 1 ? "memory" : "memories"}?
            </p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-zinc-500">
              Recall wants to permanently delete everything about “{pending.about}”. This cannot
              be undone.
            </p>
            <div className="mt-5 flex max-h-52 flex-col gap-2.5 overflow-y-auto">
              {pending.preview.map((m, i) => (
                <p
                  key={i}
                  className="border-l-2 border-red-200 pl-3 text-[13.5px] leading-relaxed text-zinc-500 line-through decoration-red-300/70"
                >
                  {m}
                </p>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => pending.resolve(true)}
                className="rounded-full bg-red-600 px-6 py-2.5 text-[13.5px] font-medium text-white transition-opacity hover:opacity-85"
              >
                Forget them
              </button>
              <button
                onClick={() => pending.resolve(false)}
                className="rounded-full border border-black/[0.1] bg-white px-6 py-2.5 text-[13.5px] font-medium text-zinc-700 transition-colors hover:border-black/[0.25]"
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
