"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
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

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" x2="12" y1="18" y2="21.5" />
      {off && <line x1="3.5" x2="20.5" y1="3.5" y2="20.5" stroke="currentColor" />}
    </svg>
  );
}

function EndIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  );
}

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

function VoiceCore({
  engine,
  greetingName,
  memoryCount,
}: {
  engine: Engine;
  greetingName?: string;
  memoryCount: number;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [pending, setPending] = useState<PendingForget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  // ?orb=speaking forces a visual state — QA and demo framing only.
  // Read after mount so server and client render the same first frame.
  const [forced, setForced] = useState<OrbState | null>(null);
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("orb");
    if (f && ["idle", "connecting", "listening", "speaking", "thinking"].includes(f))
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time URL read after hydration
      setForced(f as OrbState);
  }, []);
  const seq = useRef(0);
  const isSpeakingRef = useRef(false);

  // the orb scales to the window — never overflows a small screen
  const orbSize = useSyncExternalStore(
    subscribeResize,
    () =>
      Math.max(
        240,
        Math.min(420, Math.round(window.innerWidth * 0.88), Math.round(window.innerHeight * 0.58)),
      ),
    () => 420,
  );

  // Escape closes the approval sheet the safe way — nothing gets deleted
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pending.resolve(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  const conversation = useConversation({
    onMessage: ({ message, role }) =>
      setLines((l) => [...l.slice(-30), { role, text: message }]),
    onError: (message) => setError(typeof message === "string" ? message : "Connection error"),
  });
  const { status, isSpeaking } = conversation;
  const connected = status === "connected";
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

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
          today: new Date().toISOString().slice(0, 10),
          weekday: new Date().toLocaleDateString("en-US", { weekday: "long" }),
        },
        clientTools: {
          search_memories: ({ query }: { query: string }) =>
            track("searching memories", async () => {
              const data = await postJson("/api/recall", { q: query, limit: 6 });
              const hits = (data.results ?? [])
                .map((r: { memory?: string; chunk?: string }) => r.memory ?? r.chunk)
                .filter(Boolean);
              return hits.length
                ? `Found ${hits.length} memories:\n${hits.map((h: string) => `- ${h}`).join("\n")}`
                : "No memories found for that.";
            }),
          get_profile: () =>
            track("reading profile", async () => {
              const res = await fetch("/api/profile");
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
                source: "recall-voice",
              });
              return "Saved. The user can watch it join their constellation.";
            }),
          preview_forget: ({ about }: { about: string }) =>
            track("previewing forget", async () => {
              const data = await postJson("/api/forget", { query: about, dryRun: true });
              return data.count
                ? `${data.count} memories would be deleted:\n${data.memories.map((m: string) => `- ${m}`).join("\n")}`
                : "Nothing matches that.";
            }),
          execute_forget: ({ about }: { about: string }) =>
            track("awaiting approval", async () => {
              const preview = await postJson("/api/forget", { query: about, dryRun: true });
              if (!preview.count) return "Nothing matches that — nothing to delete.";
              const approved = await new Promise<boolean>((resolve) =>
                setPending({ about, preview: preview.memories ?? [], resolve }),
              );
              setPending(null);
              if (!approved) return "The user denied the deletion on screen. Nothing was deleted.";
              const res = await postJson("/api/forget", { query: about, dryRun: false });
              return `Deleted ${res.count} memories. They are gone.`;
            }),
          get_briefing: () =>
            track("fetching briefing", async () => {
              const res = await fetch("/api/briefings");
              const data = await res.json();
              const latest = data.briefings?.[0];
              return latest?.content ?? "No briefing yet — I haven't dreamed since we last spoke.";
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
    forced
      ? forced
      : status === "connecting"
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
  const h = new Date().getHours();
  const greeting = h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      {/* the orb — dead center of everything, and the only button you need */}
      <div className="pointer-events-none absolute left-1/2 top-[44%] z-10 -translate-x-1/2 -translate-y-1/2">
        <div className="pointer-events-auto">
          <VoiceOrb state={orbState} getLevel={getLevel} onClick={wake} size={orbSize} />
        </div>
      </div>

      {/* status + captions live in a fixed band under the orb */}
      <div className="pointer-events-none absolute inset-x-0 top-[67%] z-20 flex flex-col items-center gap-3 px-6 text-center">
        <p className="h-4 font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
          {orbState === "idle"
            ? ""
            : orbState === "connecting"
              ? "waking"
              : activity.length > 0
                ? activity[activity.length - 1].label
                : orbState}
        </p>

        {!connected && status !== "connecting" && (
          <div className="pointer-events-auto flex flex-col items-center gap-4">
            <p className="text-[17px] font-light tracking-[0.01em] text-zinc-300">
              {memoryCount === 0
                ? "Your sky is empty."
                : `${greeting}${greetingName ? `, ${greetingName}` : ""}.`}
            </p>
            <button
              onClick={wake}
              className="animate-hint font-mono text-[10px] uppercase tracking-[0.42em] text-zinc-600 transition-colors duration-300 hover:text-zinc-300"
            >
              {memoryCount === 0
                ? "tap the orb — tell it something worth keeping"
                : "tap the orb to talk"}
            </button>
          </div>
        )}

        {connected && (
          <div className="flex max-w-xl flex-col items-center gap-2.5">
            {lastUser && (
              <p className="text-[12.5px] leading-relaxed text-zinc-500">{lastUser.text}</p>
            )}
            {lastAgent && (
              <p className="animate-rise text-[16.5px] leading-relaxed tracking-[-0.01em] text-zinc-100 [text-shadow:0_2px_24px_rgb(9_9_12/0.9)]">
                {lastAgent.text}
              </p>
            )}
          </div>
        )}

        {error && <p className="text-[12.5px] text-red-400">{error}</p>}
        {engine === "offline" && (
          <p className="text-[12.5px] text-amber-400/90">
            memory engine offline — the voice can talk but can&apos;t reach your memories
          </p>
        )}
      </div>

      {/* the pitch, whispered */}
      {!connected && status !== "connecting" && (
        <p className="pointer-events-none absolute inset-x-0 bottom-7 z-20 text-center font-mono text-[9.5px] uppercase tracking-[0.32em] text-zinc-700">
          every memory lives on this machine
        </p>
      )}

      {/* liquid-glass controls */}
      {connected && (
        <div className="absolute inset-x-0 bottom-8 z-30 flex items-center justify-center gap-3.5">
          <button
            onClick={() => conversation.setMuted(!conversation.isMuted)}
            aria-label={conversation.isMuted ? "Unmute microphone" : "Mute microphone"}
            className={
              "glass-chip flex size-12 items-center justify-center rounded-full transition-all hover:scale-105 hover:shadow-[0_0_28px_-6px_rgb(130_150_255/0.5)] " +
              (conversation.isMuted
                ? "text-amber-300 hover:border-amber-300/40"
                : "text-zinc-300 hover:border-white/25 hover:text-white")
            }
          >
            <MicIcon off={conversation.isMuted} />
          </button>

          <form onSubmit={sendTyped}>
            <input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                conversation.sendUserActivity();
              }}
              placeholder="or type it"
              className="glass-chip h-12 w-60 rounded-full px-5 text-center text-[13.5px] text-zinc-100 transition-all placeholder:text-zinc-600 focus:border-white/25 focus:shadow-[0_0_36px_-8px_rgb(130_150_255/0.45)] sm:w-72"
            />
          </form>

          <button
            onClick={() => void conversation.endSession()}
            aria-label="End the conversation"
            className="glass-chip flex size-12 items-center justify-center rounded-full text-zinc-300 transition-all hover:scale-105 hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-300 hover:shadow-[0_0_28px_-6px_rgb(248_113_113/0.45)]"
          >
            <EndIcon />
          </button>
        </div>
      )}

      {/* approval sheet — the agent is frozen until you decide */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-md">
          <div className="glass animate-rise w-full max-w-md rounded-3xl p-7 text-left">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-red-400">
              approval required
            </p>
            <p className="mt-3 text-[17px] font-semibold tracking-tight text-white">
              Forget {pending.preview.length}{" "}
              {pending.preview.length === 1 ? "memory" : "memories"}?
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
              Recall wants to permanently delete everything about “{pending.about}”. This cannot
              be undone.
            </p>
            <div className="mt-5 flex max-h-52 flex-col gap-2.5 overflow-y-auto">
              {pending.preview.map((m, i) => (
                <p
                  key={i}
                  className="border-l-2 border-red-400/30 pl-3 text-[13px] leading-relaxed text-zinc-500 line-through decoration-red-400/50"
                >
                  {m}
                </p>
              ))}
            </div>
            <div className="mt-7 flex gap-3">
              <button
                onClick={() => pending.resolve(true)}
                className="rounded-full bg-red-500 px-6 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-red-400"
              >
                Forget them
              </button>
              <button
                onClick={() => pending.resolve(false)}
                className="glass-chip rounded-full px-6 py-2.5 text-[13px] font-medium text-zinc-200 transition-all hover:border-white/25"
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function VoicePanel(props: {
  engine: Engine;
  greetingName?: string;
  memoryCount: number;
}) {
  return (
    <ConversationProvider>
      <VoiceCore {...props} />
    </ConversationProvider>
  );
}
