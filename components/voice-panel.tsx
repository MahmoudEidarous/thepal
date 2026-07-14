"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { VoiceOrb, type OrbState } from "./voice-orb";
import { DEMO_CARDS, SenseDock, type MoodData, type SenseCard, type WebSource } from "./sense-cards";
import { DEMO_STORY, StoryOverlay, type StoryBeat, type StoryState } from "./story-mode";
import { fetchWeather, geocode, locate, weatherOneLiner, type Place } from "@/lib/senses";
import { hasLatestUserTranscriptEvidence } from "@/lib/memory/relationship-source-policy";

type Line = { role: "user" | "agent"; text: string };
type Activity = { id: number; label: string };
type PendingForget = {
  about: string;
  preview: string[];
  resolve: (approved: boolean) => void;
};

type Engine = "online" | "offline" | "checking";

// what /api/capture and /api/amend hand back for the filed card
type EnvelopePayload = {
  text?: string;
  type?: string;
  due?: string | null;
  storyDate?: string | null;
  salience?: number;
  entities?: Array<{ name: string; kind?: string }>;
  commitments?: Array<{ content: string; due: string | null }>;
  prospective?: { topic: string; action: string; firePolicy: "once" } | null;
};

const toFiled = (e: EnvelopePayload) => ({
  type: e.type ?? "memory",
  due: e.due ?? null,
  storyDate: e.storyDate ?? null,
  salience: e.salience ?? 0.5,
  entities: (e.entities ?? []).map((en) => ({ name: en.name, kind: en.kind ?? "thing" })),
  commitments: e.commitments ?? [],
  prospective: e.prospective ?? null,
});

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
  selectedMemory,
}: {
  engine: Engine;
  greetingName?: string;
  memoryCount: number;
  selectedMemory?: string | null;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const linesRef = useRef<Line[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [pending, setPending] = useState<PendingForget | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ?orb=speaking forces a visual state — QA and demo framing only.
  // Read after mount so server and client render the same first frame.
  const [forced, setForced] = useState<OrbState | null>(null);
  // senses — where they are (IP-level, resolved silently at wake) and
  // what the orb has looked at this session
  const placeRef = useRef<Place | null>(null);
  const [ambient, setAmbient] = useState<string | null>(null);
  const [cards, setCards] = useState<SenseCard[]>([]);
  const pushCard = (c: SenseCard) => setCards((cs) => [c, ...cs].slice(0, 3));
  const updateCard = (id: number, patch: Partial<SenseCard>) =>
    setCards((cs) => cs.map((c) => (c.id === id ? ({ ...c, ...patch } as SenseCard) : c)));
  const dismissCard = (id: number) => setCards((cs) => cs.filter((c) => c.id !== id));

  // story mode — the overlay and the voice share one script. The ref is
  // what the client tools read (their closures outlive renders); the
  // state is what the screen renders.
  const storyRef = useRef<StoryState | null>(null);
  const [storyView, setStoryView] = useState<StoryState | null>(null);
  const setStory = (s: StoryState | null) => {
    storyRef.current = s;
    setStoryView(s);
    if (!s) clearStoryFlips();
  };
  // story pacing — the LLM writes chapters faster than the voice can
  // speak them, so the AUDIO runs ahead uninterrupted (no dead air,
  // ever) while the visual advances are queued and released on the
  // rhythm of the narration itself: each star holds for its chapter's
  // estimated breath. The user speaking freezes the queue — the sky
  // never advances over an interruption.
  const storyFlips = useRef<Array<{ next: number; dwellMs: number }>>([]);
  const storyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAgentLine = useRef("");
  const clearStoryFlips = () => {
    storyFlips.current = [];
    if (storyTimer.current) {
      clearTimeout(storyTimer.current);
      storyTimer.current = null;
    }
  };
  const pumpStoryFlips = () => {
    if (storyTimer.current) return;
    const job = storyFlips.current.shift();
    if (!job) return;
    storyTimer.current = setTimeout(() => {
      storyTimer.current = null;
      const s = storyRef.current;
      if (s) {
        if (job.next >= s.beats.length) {
          setStory({ ...s, done: true });
          setTimeout(() => {
            if (storyRef.current?.done) setStory(null);
          }, 7_000);
        } else {
          setStory({ ...s, active: job.next, done: false });
        }
      }
      pumpStoryFlips();
    }, job.dwellMs);
  };
  const queueStoryFlip = (next: number, dwellMs: number) => {
    storyFlips.current.push({ next, dwellMs });
    pumpStoryFlips();
  };
  // how long the chapter she just wrote will take to say — spoken v3
  // runs ~140wpm with its pauses; clamped so drift can never run away
  const narrationDwellMs = () => {
    const words = lastAgentLine.current.split(/\s+/).filter(Boolean).length;
    return Math.min(9_000, Math.max(2_600, words * 420));
  };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const f = params.get("orb");
    if (f && ["idle", "connecting", "listening", "speaking", "thinking"].includes(f))
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time URL read after hydration
      setForced(f as OrbState);
    // ?cards=demo renders sample sense cards — design QA and demo framing
    if (params.get("cards") === "demo") setCards(DEMO_CARDS);
    // ?story=demo runs the story overlay on rails — no engine, no session
    if (params.get("story") === "demo") {
      setStory(DEMO_STORY);
      const t = setInterval(() => {
        const s = storyRef.current;
        if (!s) return clearInterval(t);
        if (s.active + 1 >= s.beats.length) {
          setStory({ ...s, done: true });
          clearInterval(t);
        } else {
          setStory({ ...s, active: s.active + 1 });
        }
      }, 2_600);
      return () => clearInterval(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time URL read; setStory writes state and refs only
  }, []);
  const seq = useRef(0);
  const isSpeakingRef = useRef(false);
  // Prospective memories are matched automatically against finalized
  // user turns. The server does exact topic matching before a guarded
  // fuzzy fallback; seen IDs are a per-session cooldown so one trigger
  // can never nag twice while its lifecycle update settles.
  const prospectiveEnabledRef = useRef(false);
  const prospectiveSeenRef = useRef(new Set<string>());
  const contextTurnRef = useRef(0);
  const sessionIdRef = useRef("");

  // what you owe, at a glance — refreshed each minute while idle
  const [agenda, setAgenda] = useState<{ open: number; next: string | null }>({
    open: 0,
    next: null,
  });
  useEffect(() => {
    const load = () =>
      fetch("/api/agenda")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          const items = d.commitments as Array<{ due: string | null; overdue: boolean; dueToday: boolean }>;
          const next = items.find((c) => c.due);
          setAgenda({
            open: items.length,
            next: next
              ? next.overdue
                ? "overdue"
                : next.dueToday
                  ? "due today"
                  : `due ${new Date(`${next.due}T12:00:00`).toLocaleDateString("en-US", {
                      weekday: "short",
                    })}`
              : null,
          });
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

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
    onMessage: ({ message, role }) => {
      if (role === "user") {
        // the user's voice freezes the constellation where the audio
        // actually is — queued chapters must not light over them
        clearStoryFlips();
        if (message.trim()) {
          const turn = ++contextTurnRef.current;
          const recentTurns = [...linesRef.current.slice(-7), { role: "user" as const, text: message }];
          void postJson("/api/context/compile", {
            query: message,
            sessionId: sessionIdRef.current,
            momentKind: "user_turn",
            recentTurns,
            selectedMemory,
            seenProspective: [...prospectiveSeenRef.current],
            includeProspective: prospectiveEnabledRef.current,
            maxTokens: 1_400,
          })
            .then((data) => {
              if (turn !== contextTurnRef.current) return;
              const surfaced = data.attention?.surface as
                | { kind?: string; sourceItemId?: string }
                | null
                | undefined;
              if (surfaced?.kind === "prospective" && surfaced.sourceItemId) {
                prospectiveSeenRef.current.add(surfaced.sourceItemId);
              }
              try {
                if (typeof data.agentText === "string") {
                  conversationRef.current.sendContextualUpdate(data.agentText);
                }
              } catch {}
            })
            .catch(() => {});
        }
      } else {
        lastAgentLine.current = message;
      }
      const nextLines = [...linesRef.current.slice(-30), { role, text: message }];
      linesRef.current = nextLines;
      setLines(nextLines);
    },
    onError: (message) => setError(typeof message === "string" ? message : "Connection error"),
  });
  const { status, isSpeaking } = conversation;
  const connected = status === "connected";
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // the user left the story themselves (✕ or Esc) — the agent must hear
  // about it, or it keeps narrating into a dark room
  const conversationRef = useRef(conversation);
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);
  const closeStoryByHand = () => {
    if (!storyRef.current) return;
    setStory(null);
    try {
      conversationRef.current.sendContextualUpdate(
        "The user closed the story overlay themselves. The tour is over — do not call advance_story again. Pick the conversation back up naturally, no ceremony.",
      );
    } catch {}
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && storyRef.current) closeStoryByHand();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs only
  }, []);

  // The instant yield. Server-side interruption takes a beat (the ASR
  // has to transcribe the user's first word before it cuts the agent);
  // until it lands she keeps playing over them. So the mic is watched
  // locally: the user's voice rising while she speaks ducks her volume
  // under them within ~120ms, and the real interruption finishes the
  // cut. False alarm (a cough, a passing truck) restores after a beat.
  const duckedRef = useRef(false);
  useEffect(() => {
    if (!connected) return;
    let voiceTicks = 0;
    let quietTicks = 0;
    const restore = () => {
      duckedRef.current = false;
      quietTicks = 0;
      try {
        conversationRef.current.setVolume({ volume: 1 });
      } catch {}
    };
    const t = setInterval(() => {
      const c = conversationRef.current;
      let input = 0;
      try {
        input = c.getInputVolume();
      } catch {
        return;
      }
      if (!isSpeakingRef.current) {
        voiceTicks = 0;
        if (duckedRef.current) restore();
        return;
      }
      if (input > 0.09) {
        voiceTicks += 1;
        quietTicks = 0;
        if (voiceTicks >= 2 && !duckedRef.current) {
          duckedRef.current = true;
          try {
            c.setVolume({ volume: 0.12 });
          } catch {}
        }
      } else {
        voiceTicks = 0;
        // ducked but the voice never followed through — give it ~1.2s
        // then let her back up
        if (duckedRef.current && ++quietTicks >= 20) restore();
      }
    }, 60);
    return () => {
      clearInterval(t);
      restore();
    };
  }, [connected]);

  // a story doesn't outlive its narrator — clear it when the session ends
  const wasConnected = useRef(false);
  useEffect(() => {
    if (wasConnected.current && !connected) setStory(null);
    wasConnected.current = connected;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setStory writes state and refs only
  }, [connected]);

  // the agent sees what you're looking at: clicking a star mid-session
  // tells it, so "what about this one?" just works
  useEffect(() => {
    if (!connected || !selectedMemory) return;
    try {
      conversation.sendContextualUpdate(
        `The user just selected a memory star on screen: "${selectedMemory}". If they say "this" or "that one", they mean this memory. Don't comment unless they bring it up.`,
      );
    } catch {
      // context is best-effort — never break the session over it
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMemory, connected]);

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
    linesRef.current = [];
    contextTurnRef.current = 0;
    sessionIdRef.current = crypto.randomUUID();
    try {
      // agenda + boundaries ride in with the session — the agent knows
      // what you owe and what it must never suggest, before you speak.
      // Location + today's sky resolve in the same breath, so "how's the
      // weather?" costs zero tool calls.
      const [res, agendaData, pinnedData, briefingData, attentionData, prospectiveData, senses] = await Promise.all([
        fetch("/api/voice/signed-url"),
        fetch("/api/agenda")
          .then((r) => (r.ok ? r.json() : { commitments: [] }))
          .catch(() => ({ commitments: [] })),
        fetch("/api/pinned")
          .then((r) => (r.ok ? r.json() : { pinned: [] }))
          .catch(() => ({ pinned: [] })),
        fetch("/api/briefings")
          .then((r) => (r.ok ? r.json() : { briefings: [] }))
          .catch(() => ({ briefings: [] })),
        postJson("/api/attention/decide", {
          query: "",
          sessionId: sessionIdRef.current,
          momentKind: "session_start",
          includeHistory: false,
          includeProspective: true,
          includeObligations: true,
          includeAnniversaries: true,
        }).catch(() => ({ attention: null, attentionText: "", relationshipText: "" })),
        fetch("/api/prospective")
          .then((r) => (r.ok ? r.json() : { triggers: [] }))
          .catch(() => ({ triggers: [] })),
        (async () => {
          const p = await locate();
          if (!p) return null;
          placeRef.current = p;
          const w = await fetchWeather(p).catch(() => null);
          return { p, w };
        })().catch(() => null),
      ]);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "couldn't reach ElevenLabs");

      type AgendaItem = { content: string; due: string | null; overdue: boolean; dueToday: boolean };
      // nearest-due first, capped — a wall of ledger drowns the persona;
      // the agent can always pull the full list through get_agenda
      const allOpen = agendaData.commitments as AgendaItem[];
      const agendaText = allOpen.length
        ? allOpen
            .slice(0, 10)
            .map(
              (c) =>
                `- ${c.content}${
                  c.due
                    ? ` (due ${c.due}${c.overdue ? " — OVERDUE" : c.dueToday ? " — TODAY" : ""})`
                    : ""
                }`,
            )
            .join("\n") +
          (allOpen.length > 10
            ? `\n(…and ${allOpen.length - 10} more — get_agenda has the full ledger)`
            : "")
        : "none";
      const boundariesText = (pinnedData.pinned as string[]).length
        ? (pinnedData.pinned as string[]).map((p) => `- ${p}`).join("\n")
        : "none";

      type AttentionSurface = {
        kind: string;
        text: string;
        sourceItemId: string;
        metadata?: Record<string, string | number | boolean | null>;
      };
      const attentionSurface = (attentionData.attention?.surface ?? null) as AttentionSurface | null;
      // Raw anniversary inventory is no longer injected. The policy layer
      // must authorize one before the personality layer is allowed to see it.
      const annivText = attentionSurface?.kind === "anniversary" ? `- ${attentionSurface.text}` : "none";
      const attentionText =
        typeof attentionData.attentionText === "string"
          ? `${attentionData.attentionText}\n\n${
              typeof attentionData.relationshipText === "string"
                ? attentionData.relationshipText
                : ""
            }`.trim()
          : "No proactive memory aside is authorized at session start.";

      type Prospective = { id: string; topic: string; action: string; snoozedUntil?: string | null };
      const prospective = (prospectiveData.triggers ?? []) as Prospective[];
      prospectiveSeenRef.current.clear();
      prospectiveEnabledRef.current = prospective.length > 0;
      const prospectiveText =
        prospective
          .map(
            (trigger) =>
              `- id=${trigger.id}; topic="${trigger.topic}"; reminder="${trigger.action}"${
                trigger.snoozedUntil ? `; snoozed until ${trigger.snoozedUntil}` : ""
              }`,
          )
          .join("\n") || "none";

      // where they are + today's sky, carried in the agent's pocket
      const placeText = senses?.p
        ? `${senses.p.city}${senses.p.region ? `, ${senses.p.region}` : ""}, ${senses.p.country}` +
          (senses.w ? `. Sky right now — ${weatherOneLiner(senses.w)}` : "")
        : "unknown";
      setAmbient(
        senses?.p
          ? `${senses.p.city}${senses.w ? ` · ${senses.w.now.temp}° ${senses.w.now.label}` : ""}`
          : null,
      );

      // The briefing remains available on request. Its Focus line no longer
      // bypasses attention and takes over the opening by itself.
      type Briefing = { content: string; createdAt?: string };
      const latest = ((briefingData.briefings ?? []) as Briefing[])[0];
      const fresh =
        latest?.createdAt &&
        Date.now() - new Date(latest.createdAt).getTime() < 20 * 3600_000;
      const briefingText = fresh ? latest.content.slice(0, 1200) : "none yet";

      // the agent's first words — computed here, from the live ledger
      const items = agendaData.commitments as AgendaItem[];
      const urgent = attentionSurface?.kind === "obligation"
        ? items.find(
            (item) =>
              attentionSurface.text.includes(item.content) ||
              item.content.includes(attentionSurface.text),
          )
        : undefined;
      const requiredRepair = (
        (attentionData.attention?.required ?? []) as Array<{ kind?: string; text?: string }>
      ).find((candidate) => candidate.kind === "repair" && candidate.text);
      const namePart = greetingName ? `, ${greetingName}` : "";
      const hour = new Date().getHours();
      const hi = hour < 5 ? `Still up${namePart}?` : `Hey${namePart}.`;
      const dueDay = (d: string) =>
        new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
      // ledger items are written in the user's voice ("I still owe…") —
      // spoken BY the agent they must flip person, or the agent owes it
      const inYourVoice = (s: string) =>
        s
          .replace(/\bI am\b/g, "you are")
          .replace(/\bI'm\b/g, "you're")
          .replace(/\bI've\b/g, "you've")
          .replace(/\bI\b/g, "you")
          .replace(/\b[Mm]y\b/g, "your")
          .replace(/\bme\b/g, "you");
      const urgentLine = urgent
        ? `${inYourVoice(urgent.content.split(/(?<=[.!?])\s/)[0]).replace(/\.$/, "")}${
            urgent.overdue
              ? " — that one's overdue"
              : urgent.dueToday
                ? " — that's today"
                : urgent.due
                  ? `, due ${dueDay(urgent.due)}`
                  : ""
          }`
        : null;
      const opening =
        requiredRepair?.text
          ? `${hi} Before anything else: ${requiredRepair.text}. That was on me. I'm sorry. Let me correct it before we move on.`
          : memoryCount === 0
            ? `${hi} We haven't met — I'm Recall. Whatever you tell me, I keep. So: who are you?`
            : urgentLine
              ? `${hi} Before I forget — ${urgentLine}. Talk to me.`
              : attentionSurface?.kind === "anniversary"
                ? `${hi} ${attentionSurface.text}. That came back to me today.`
                : attentionSurface?.kind === "thread_follow_up"
                  ? `${hi} I've been wondering about this: ${attentionSurface.text}. What happened?`
                  : `${hi} ${memoryCount} memories and counting. What's new?`;

      conversation.startSession({
        signedUrl: data.signedUrl,
        connectionType: "websocket",
        dynamicVariables: {
          today: new Date().toLocaleDateString("en-CA"),
          weekday: new Date().toLocaleDateString("en-US", { weekday: "long" }),
          // sessions cap at 15 minutes, so a start-of-session clock is
          // never more than 15 minutes stale — good enough to feel the hour
          now: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
          agenda: agendaText,
          boundaries: boundariesText,
          briefing: briefingText,
          anniversaries: annivText,
          prospective: prospectiveText,
          attention: attentionText,
          place: placeText,
          opening,
        },
        clientTools: {
          record_relationship_event: ({
            kind,
            summary,
            user_evidence,
            target_id,
            action,
            due_at,
            scope,
            rule,
            dimension,
            direction,
            reference,
            theme,
            artifact_id,
            policy_patch,
            severity,
            rupture_kind,
          }: {
            kind: string;
            summary: string;
            user_evidence?: string;
            target_id?: string;
            action?: string;
            due_at?: string;
            scope?: string;
            rule?: string;
            dimension?: string;
            direction?: number | string;
            reference?: string;
            theme?: string;
            artifact_id?: string;
            policy_patch?: string;
            severity?: string;
            rupture_kind?: string;
          }) =>
            track("learning our rhythm", async () => {
              const latestUser = [...linesRef.current]
                .reverse()
                .find((line) => line.role === "user")?.text ?? "";
              if (!hasLatestUserTranscriptEvidence(kind, user_evidence, latestUser)) {
                return "Relationship event NOT recorded: explicit user authority requires a short exact phrase from the user's latest turn. Do not claim it was saved; ask only if the distinction matters.";
              }
              const eventKind =
                kind === "agent_promise"
                  ? "agent_promise"
                  : kind.startsWith("promise_")
                    ? "promise_outcome"
                    : kind === "boundary"
                      ? "boundary"
                      : kind === "recall_mistake"
                        ? "recall_mistake"
                        : kind === "repair_attempt"
                          ? "repair_attempt"
                          : kind.startsWith("repair_")
                            ? "repair_outcome"
                            : kind === "feedback"
                              ? "interaction_feedback"
                              : kind === "humor_user_reuse"
                                ? "shared_reference"
                                : "humor_episode";
              const source =
                kind === "boundary" ||
                kind === "feedback" ||
                kind === "humor_user_reuse" ||
                kind === "repair_accepted" ||
                kind === "repair_failed"
                  ? "user_explicit"
                  : kind.startsWith("promise_") || kind === "humor_callback"
                    ? "system_outcome"
                    : "recall_observed";
              const payload = {
                summary,
                targetId: target_id ?? null,
                action: action ?? null,
                dueAt: due_at ?? null,
                promiseOutcome:
                  kind === "promise_kept"
                    ? "kept"
                    : kind === "promise_broken"
                      ? "broken"
                      : kind === "promise_cancelled"
                        ? "cancelled"
                        : null,
                repairOutcome:
                  kind === "repair_accepted"
                    ? "accepted"
                    : kind === "repair_failed"
                      ? "failed"
                      : null,
                severity: severity ?? null,
                ruptureKind: rupture_kind ?? null,
                dimension: dimension ?? null,
                direction:
                  direction === -1 || direction === "less"
                    ? -1
                    : direction === 1 || direction === "more"
                      ? 1
                      : null,
                explicit: source === "user_explicit",
                scope: scope ?? null,
                rule: rule ?? null,
                boundaryStatus: kind === "boundary" ? "active" : null,
                artifactId: artifact_id ?? null,
                reference: reference ?? null,
                theme: theme ?? null,
                humorRole:
                  kind === "humor_seed"
                    ? "seed"
                    : kind === "humor_callback"
                      ? "recall_callback"
                      : kind === "humor_user_reuse"
                        ? "user_reuse"
                        : null,
                policyPatch: policy_patch ?? null,
                outcome:
                  kind === "humor_user_reuse"
                    ? "positive"
                    : kind === "humor_callback"
                      ? "neutral"
                      : null,
              };
              const data = await postJson("/api/relationship", {
                sessionId: sessionIdRef.current,
                kind: eventKind,
                source,
                sensitivity: "normal",
                payload,
              });
              const ruptureStatus = data.state?.rupture?.status ?? "none";
              return `Relationship event recorded as ${data.event.id}. Rupture status: ${ruptureStatus}. Do not announce the logging. If this is a mistake or rupture, repair it now: name the specific failure, own it, correct it, and skip humor.`;
            }),
          search_memories: ({ query }: { query: string }) =>
            track("searching memories", async () => {
              const data = await postJson("/api/context/compile", {
                query,
                sessionId: sessionIdRef.current,
                momentKind: "user_turn",
                recentTurns: linesRef.current.slice(-8),
                selectedMemory,
                includeProspective: false,
                includeAnniversaries: false,
                focusMode: true,
                maxTokens: 1_600,
              });
              type CompiledItem = {
                text: string;
                confidence?: string | null;
                metadata?: { toldAt?: string | null };
              };
              const state = [
                ...(data.currentBeliefs ?? []),
                ...(data.uncertainty ?? []),
                ...(data.activeThreads ?? []),
              ] as CompiledItem[];
              const history = (data.historicalEvidence ?? []) as CompiledItem[];
              const raw = [
                ...state.map((item) => ({ text: item.text, told: null })),
                ...history.map((item) => ({ text: item.text, told: item.metadata?.toldAt ?? null })),
              ];
              // the receipts: what the answer is standing on, cited on screen
              if (raw.length)
                pushCard({ id: ++seq.current, kind: "receipts", status: "ready", hits: raw, ttl: 10_000 });
              return typeof data.agentText === "string"
                ? data.agentText
                : "No applicable memory context was compiled for that.";
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
          // fire-and-forget: the agent never waits on the enricher. The
          // filing card shows what the envelope stamped — write path made
          // visible — and a failure comes back as a contextual update so
          // the agent can own it honestly.
          add_memory: ({ content, kind, due }: { content: string; kind?: string; due?: string }) => {
            const id = ++seq.current;
            setActivity((a) => [...a, { id, label: "remembering" }]);
            pushCard({ id, kind: "filed", status: "loading", text: content, ttl: 8_000 });
            void postJson("/api/capture", {
              content,
              kind: kind ?? "memory",
              due,
              source: "recall-voice",
            })
              .then((d) => {
                const e = d.envelope as EnvelopePayload | undefined;
                if (!e) {
                  updateCard(id, { status: "error" });
                  return;
                }
                // The dedicated prospective tool is the preferred route,
                // but the generic Writer recognizes the same intention.
                // Keep matching live if the agent chose the broad save tool.
                if (e.prospective) prospectiveEnabledRef.current = true;
                const conflict = d.conflict as
                  | { text: string; told?: string | null }
                  | undefined;
                updateCard(id, {
                  status: "ready",
                  text: e.text ?? content,
                  envelope: toFiled(e),
                  // a reschedule quietly retired the old terms — show it
                  ...(typeof d.superseded === "string" && !conflict?.text
                    ? { replaces: d.superseded }
                    : {}),
                  // "this changes what I knew" — the collision, annotated
                  ...(conflict?.text
                    ? { updates: { text: conflict.text, told: conflict.told ?? null } }
                    : {}),
                });
                if (conflict?.text) {
                  try {
                    conversationRef.current.sendContextualUpdate(
                      `What they just said UPDATES something older you knew: "${conflict.text}"${
                        conflict.told ? ` (told ${String(conflict.told).slice(0, 10)})` : ""
                      }. The old version stays as history; the newest telling is the truth now. If the flip is interesting, ONE short grinning line ("wasn't this X last week?") — if it's mundane, stay quiet.`,
                    );
                  } catch {}
                }
              })
              .catch((err) => {
                updateCard(id, { status: "error" });
                try {
                  conversation.sendContextualUpdate(
                    `That last save actually failed (${err instanceof Error ? err.message : "engine error"}). Tell the user their memory didn't stick and offer to try again.`,
                  );
                } catch {}
              })
              .finally(() => setActivity((a) => a.filter((x) => x.id !== id)));
            return "Saved. Do not mention or announce the save — just keep the conversation going.";
          },
          add_prospective_memory: ({
            topic,
            reminder,
          }: {
            topic: string;
            reminder: string;
          }) =>
            track("remembering forward", async () => {
              const cardId = ++seq.current;
              pushCard({
                id: cardId,
                kind: "filed",
                status: "loading",
                text: `Next time ${topic} comes up, remind me: ${reminder}`,
                ttl: 10_000,
              });
              try {
                const data = await postJson("/api/prospective", {
                  operation: "create",
                  topic,
                  action: reminder,
                  source: "recall-voice",
                });
                prospectiveEnabledRef.current = true;
                updateCard(cardId, {
                  status: "ready",
                  text: data.trigger?.content ?? `Next time ${topic} comes up: ${reminder}`,
                  envelope: toFiled({
                    type: "commitment",
                    salience: 0.78,
                    prospective: { topic, action: reminder, firePolicy: "once" },
                  }),
                });
                return `Prospective memory created for topic "${topic}". Keep it in mind for this session too. Do not announce the save; react to what the reminder means.`;
              } catch (error) {
                updateCard(cardId, { status: "error" });
                throw error;
              }
            }),
          get_prospective_memories: () =>
            track("checking future memories", async () => {
              const res = await fetch("/api/prospective");
              const data = await res.json().catch(() => ({ triggers: [] }));
              const triggers = (data.triggers ?? []) as Array<{
                id: string;
                topic: string;
                action: string;
                snoozedUntil?: string | null;
              }>;
              prospectiveEnabledRef.current = triggers.length > 0;
              return triggers.length
                ? `${triggers.length} open prospective ${triggers.length === 1 ? "memory" : "memories"}:\n${triggers
                    .map(
                      (trigger) =>
                        `- id=${trigger.id}; next time ${trigger.topic} comes up: ${trigger.action}${
                          trigger.snoozedUntil ? ` (snoozed until ${trigger.snoozedUntil})` : ""
                        }`,
                    )
                    .join("\n")}`
                : "No open prospective memories.";
            }),
          manage_prospective_memory: ({
            id,
            about,
            action,
            until,
            reason,
          }: {
            id?: string;
            about?: string;
            action: "fire" | "resolve" | "cancel" | "snooze";
            until?: string;
            reason?: string;
          }) =>
            track("updating future memory", async () => {
              const data = await postJson("/api/prospective", {
                operation: action,
                id,
                about,
                until,
                reason,
              });
              // Refresh the cheap boolean; lifecycle truth remains server-side.
              const remaining = await fetch("/api/prospective")
                .then((response) => (response.ok ? response.json() : { triggers: [] }))
                .catch(() => ({ triggers: [] }));
              prospectiveEnabledRef.current = (remaining.triggers ?? []).length > 0;
              if (action === "fire")
                return `Prospective memory consumed exactly once. Now say this reminder naturally: ${data.trigger.action}`;
              if (action === "snooze")
                return `Prospective memory snoozed until ${data.until}. Do not bring it up before then.`;
              return action === "cancel"
                ? "Prospective memory cancelled and preserved as history."
                : "Prospective memory resolved and preserved as history.";
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
          get_agenda: () =>
            track("checking the ledger", async () => {
              const res = await fetch("/api/agenda");
              const data = await res.json();
              const items = (data.commitments ?? []) as Array<{
                content: string;
                due: string | null;
                overdue: boolean;
                dueToday: boolean;
              }>;
              return items.length
                ? `${items.length} open commitment${items.length > 1 ? "s" : ""}:\n${items
                    .map(
                      (c) =>
                        `- ${c.content}${
                          c.due
                            ? ` (due ${c.due}${c.overdue ? " — OVERDUE" : c.dueToday ? " — TODAY" : ""})`
                            : ""
                        }`,
                    )
                    .join("\n")}`
                : "No open commitments. The ledger is clear.";
            }),
          // closing a commitment can take seconds (settle-polling a doc
          // that's still filing) — the agent must not hold its breath.
          // Fire, react now, hear back only if the match missed.
          complete_commitment: ({ about, outcome }: { about: string; outcome?: string }) => {
            const id = ++seq.current;
            setActivity((a) => [...a, { id, label: "closing a commitment" }]);
            void (async () => {
              try {
                const res = await fetch("/api/agenda/complete", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ q: about, outcome }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                  try {
                    conversationRef.current.sendContextualUpdate(
                      data.open?.length
                        ? `IMPORTANT — nothing was closed: no open commitment matched "${about}". Still open: ${(
                            data.open as string[]
                          )
                            .slice(0, 6)
                            .join(" | ")}. Tell the user and ask which one they meant.`
                        : "IMPORTANT — nothing was closed: the ledger has no open commitment matching that. Tell the user.",
                    );
                  } catch {}
                }
              } catch {
                try {
                  conversationRef.current.sendContextualUpdate(
                    "IMPORTANT — closing that commitment FAILED (the engine didn't answer). Tell the user it's still on the books.",
                  );
                } catch {}
              } finally {
                setActivity((a) => a.filter((x) => x.id !== id));
              }
            })();
            return outcome === "cancelled"
              ? "Striking it off as called-off — react in a few words and keep moving. If nothing matched you'll get a note; own it then."
              : "Closing it — react in a few words ('done — off the list') and keep moving. If nothing matched you'll get a note; own it then.";
          },
          // a correction rewrites the memory in place — the doc keeps its
          // place in history but stops saying the wrong thing. Fire-and-
          // forget like every save: the agent reacts to the change NOW
          // and hears back only if something needs its voice — a rewrite
          // that takes four seconds must never cost four seconds of air.
          edit_memory: ({ about, correction }: { about: string; correction: string }) => {
            const id = ++seq.current;
            setActivity((a) => [...a, { id, label: "amending a memory" }]);
            pushCard({ id, kind: "filed", status: "loading", text: correction, amended: true, ttl: 8_000 });
            const note = (text: string) => {
              try {
                conversationRef.current.sendContextualUpdate(text);
              } catch {}
            };
            void (async () => {
              try {
                const res = await fetch("/api/amend", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ query: about, correction }),
                });
                const data: {
                  after?: string;
                  candidates?: string[];
                  error?: string;
                  envelope?: EnvelopePayload;
                } = await res.json().catch(() => ({}));
                if (res.status === 409) {
                  // too fresh to rewrite — file the correction as its own
                  // memory instead; the newest telling wins at read time.
                  // No agent involvement: the recovery is deterministic.
                  const d = await postJson("/api/capture", {
                    content: correction,
                    kind: "memory",
                    source: "recall-voice",
                  }).catch(() => null);
                  const e = d?.envelope as EnvelopePayload | undefined;
                  if (e) updateCard(id, { status: "ready", text: e.text ?? correction, envelope: toFiled(e) });
                  else updateCard(id, { status: "error" });
                  return;
                }
                if (res.status === 404) {
                  dismissCard(id);
                  note(
                    data.candidates?.length
                      ? `IMPORTANT — that correction did NOT apply: no memory matched confidently. Closest: ${data.candidates
                          .slice(0, 3)
                          .join(" | ")}. Tell the user you're not sure which one they meant and ask — then edit_memory again with more specific words.`
                      : "IMPORTANT — that correction did NOT apply: nothing matched. Ask the user what exactly should change, or save it fresh with add_memory.",
                  );
                  return;
                }
                if (!res.ok) throw new Error(data.error ?? "engine error");
                const e = data.envelope;
                updateCard(id, {
                  status: "ready",
                  text: e?.text ?? data.after ?? correction,
                  envelope: e ? toFiled(e) : undefined,
                });
              } catch (err) {
                updateCard(id, { status: "error" });
                note(
                  `IMPORTANT — that correction FAILED to apply (${
                    err instanceof Error ? err.message : "engine error"
                  }). Tell the user it didn't stick and offer to try again.`,
                );
              } finally {
                setActivity((a) => a.filter((x) => x.id !== id));
              }
            })();
            return "The rewrite is filing — react to the change itself in one short line ('Friday it is') and keep talking. Never announce the edit. If it fails to land you'll get a note; own it then.";
          },
          get_briefing: () =>
            track("fetching briefing", async () => {
              const res = await fetch("/api/briefings");
              const data = await res.json();
              const latest = data.briefings?.[0];
              return latest?.content ?? "No briefing yet — I haven't dreamed since we last spoke.";
            }),
          // story mode — the voice and the constellation share one script.
          // advance_story returns exactly ONE chapter per call, so the
          // agent structurally cannot read ahead of the screen.
          show_story: ({ topic }: { topic: string }) =>
            track("setting the stage", async () => {
              const data = await postJson("/api/story", { topic });
              const beats = (data.beats ?? []) as StoryBeat[];
              if (beats.length < 2)
                return `Only ${beats.length} usable ${beats.length === 1 ? "memory" : "memories"} on that — not enough for a tour. Say so in one warm line and offer to just talk about it instead.`;
              setStory({ topic, beats, active: -1, done: false });
              return `The stage is lit: ${beats.length} chapters, ${beats[0].date} to ${
                beats[beats.length - 1].date
              }. Call advance_story now. The tour flows on its own: narrate each chapter in one or two spoken sentences, then IMMEDIATELY call advance_story again — never pause to ask, never wait. Only the user speaking stops the flow.`;
            }),
          // returns instantly so the narration never pauses to think —
          // the audio pipeline runs ahead while the queued visual flips
          // land on the rhythm of the words (see storyFlips above).
          // Passing chapter jumps anywhere ("go back to the lease part").
          advance_story: ({ chapter }: { chapter?: number } = {}) =>
            track("next chapter", async () => {
              const s = storyRef.current;
              if (!s)
                return "No story is open (or the user closed it) — do not call advance_story again. If they asked for a story, call show_story first.";
              const jump =
                typeof chapter === "number" && chapter >= 1 && chapter <= s.beats.length
                  ? chapter - 1
                  : null;
              // the story's true position is the last QUEUED flip, not
              // what the screen happens to show this instant
              const queued = storyFlips.current.length
                ? storyFlips.current[storyFlips.current.length - 1].next
                : s.active;
              const next = jump ?? queued + 1;
              if (jump !== null) {
                // an explicit jump is the user steering — land it now
                clearStoryFlips();
                setStory({ ...s, active: jump, done: false });
              } else if (next >= s.beats.length) {
                queueStoryFlip(next, narrationDwellMs());
                return "That was the last chapter — the whole path is lit. Close with ONE line about the arc, then move on.";
              } else if (s.active === -1 && queued === -1) {
                // ignition — the first star lights as the tour begins
                setStory({ ...s, active: 0, done: false });
              } else {
                queueStoryFlip(next, narrationDwellMs());
              }
              const b = s.beats[next];
              return `Chapter ${next + 1} of ${s.beats.length} — ${b.date}${
                b.dated ? "" : " (timing approximate — dated by when they told you)"
              }: ${b.text}\nNarrate this in ONE or two SHORT sentences, then IMMEDIATELY call advance_story again — no filler, no pauses, never ask. The screen paces itself to your voice.`;
            }),
          // the agent's own exit: the user said stop, or changed the subject
          end_story: () => {
            const wasOpen = !!storyRef.current;
            setStory(null);
            return wasOpen
              ? "The stage is dark — story closed. Back to the conversation, no ceremony."
              : "No story was open.";
          },
          // a web finding worth keeping becomes a memory that speaks its
          // own provenance — ask again tomorrow and it cites the source
          save_finding: ({ finding, source }: { finding: string; source?: string }) => {
            const id = ++seq.current;
            setActivity((a) => [...a, { id, label: "keeping a finding" }]);
            pushCard({ id, kind: "filed", status: "loading", text: finding, ttl: 8_000 });
            const today = new Date().toLocaleDateString("en-CA");
            const content = `${finding} (learned from ${source?.trim() || "a web search"}, ${today})`;
            void postJson("/api/capture", { content, kind: "memory", source: "recall-web" })
              .then((d) => {
                const e = d.envelope as EnvelopePayload | undefined;
                if (!e) {
                  updateCard(id, { status: "error" });
                  return;
                }
                updateCard(id, { status: "ready", text: e.text ?? finding, envelope: toFiled(e) });
              })
              .catch(() => updateCard(id, { status: "error" }))
              .finally(() => setActivity((a) => a.filter((x) => x.id !== id)));
            return "Kept, with its source. Don't announce it — keep the conversation moving.";
          },
          // the inner weather: six weeks of the envelope's emotional
          // stamps, drawn as a seismograph — no model in the loop
          get_emotional_weather: () =>
            track("reading the inner sky", async () => {
              const id = ++seq.current;
              pushCard({ id, kind: "mood", status: "loading" });
              try {
                const res = await fetch("/api/mood");
                if (!res.ok) throw new Error();
                const data = (await res.json()) as MoodData;
                updateCard(id, { status: "ready", data });
                return `${data.spoken}${
                  data.brightest ? `\nBrightest day: ${data.brightest.label} — ${data.brightest.why}` : ""
                }${
                  data.roughest ? `\nRoughest day: ${data.roughest.label} — ${data.roughest.why}` : ""
                }\nThe seismograph is on screen. Give the read in one or two spoken lines, your voice — name what made the peaks if it lands. Never recite numbers or dates mechanically.`;
              } catch {
                updateCard(id, { status: "error", error: "the needle isn't answering" });
                return "The inner-weather read failed. Say so in one short line.";
              }
            }),
          // the senses: each look at the world conjures a card on screen
          get_weather: ({ place }: { place?: string }) =>
            track("reading the sky", async () => {
              const id = ++seq.current;
              pushCard({ id, kind: "weather", status: "loading" });
              try {
                const at = place?.trim()
                  ? await geocode(place)
                  : (placeRef.current ?? (placeRef.current = await locate()));
                if (!at) {
                  updateCard(id, {
                    status: "error",
                    error: place ? `couldn't find “${place}”` : "couldn't place you",
                  });
                  return place
                    ? `No place called "${place}" found — ask them to say it differently.`
                    : "Couldn't work out their location. Ask them where they are.";
                }
                const w = await fetchWeather(at);
                updateCard(id, { status: "ready", data: w });
                return `${weatherOneLiner(w)} The card is on screen — speak only what matters, never every number.`;
              } catch {
                updateCard(id, { status: "error", error: "the sky isn't answering" });
                return "The weather service didn't answer. Say so briefly and move on.";
              }
            }),
          search_web: ({
            query,
            freshness,
            intent,
          }: {
            query: string;
            freshness?: string;
            intent?: string;
          }) =>
            track("reaching the wider world", async () => {
              const id = ++seq.current;
              pushCard({ id, kind: "search", status: "loading", query });
              let data: {
                mode: string;
                answer?: string;
                results?: WebSource[];
                freshness?: string;
                tookMs?: number;
                error?: string;
              };
              try {
                data = await postJson("/api/search", { query, freshness, intent });
              } catch {
                updateCard(id, { status: "error", error: "the web didn't answer" });
                return "The search failed — the web didn't answer. Tell the user briefly and move on.";
              }
              if (data.mode === "clarify") {
                dismissCard(id);
                return "Too vague to search well. Ask the user ONE sharp narrowing question — which topic, name, or place exactly — then search again with a specific query. Do not apologize.";
              }
              if (data.mode === "error") {
                updateCard(id, { status: "error", error: data.error });
                return `Search unavailable: ${data.error} Tell the user honestly, in one short line.`;
              }
              const results = data.results ?? [];
              updateCard(id, {
                status: "ready",
                mode: data.mode as "answer" | "wire" | "empty",
                answer: data.answer,
                results,
                tookMs: data.tookMs,
              });
              if (data.mode === "empty" || (!results.length && !data.answer))
                return "The web came back empty on that. Say so and offer to try different words.";
              if (data.mode === "answer")
                return `Live web answer (sources are on screen — never read URLs aloud):\n${data.answer}\nSources: ${results.map((s) => s.domain).join(", ")}`;
              return (
                `Live results${data.freshness && data.freshness !== "any" ? ` from the past ${data.freshness}` : ""}, newest first. Synthesize a short spoken take in your own voice — the screen shows the sources:\n` +
                results
                  .map(
                    (s) =>
                      `- [${s.domain}${s.published ? `, ${s.published.slice(0, 10)}` : ""}] ${s.title}${s.snippet ? ` — ${s.snippet.slice(0, 180)}` : ""}`,
                  )
                  .join("\n")
              );
            }),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't start the session");
    }
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

      {/* what the orb has looked at — weather skies, live search wires */}
      <SenseDock cards={cards} onDismiss={dismissCard} />

      {/* story mode — the constellation performs while the voice narrates */}
      {storyView && (
        <StoryOverlay story={storyView} onClose={closeStoryByHand} />
      )}
      {connected && ambient && cards.length === 0 && (
        <p className="pointer-events-none absolute right-6 top-[76px] z-20 font-mono text-[9.5px] uppercase tracking-[0.22em] text-zinc-600 max-sm:hidden">
          <span className="mr-1.5 inline-block size-[4px] rounded-full bg-sky-300/70 align-middle" />
          {ambient}
        </p>
      )}

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
            {agenda.open > 0 && (
              <a
                href="/brain?tab=ledger"
                className="glass-chip animate-rise rounded-full px-3.5 py-1.5 font-mono text-[10px] tracking-[0.14em] text-zinc-400 transition-all hover:border-amber-300/30 hover:text-zinc-200"
              >
                <span className="mr-2 inline-block size-[5px] rounded-full bg-amber-300/90 align-middle shadow-[0_0_8px_1px_rgb(252_211_77/0.5)]" />
                {agenda.open} open commitment{agenda.open > 1 ? "s" : ""}
                {agenda.next ? ` · ${agenda.next}` : ""}
              </a>
            )}
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

      {/* liquid-glass controls — above the story dim, so mute/end
          stay in reach while the constellation performs. Voice only:
          the typed composer is gone, the orb is the whole interface. */}
      {connected && (
        <div className="absolute inset-x-0 bottom-8 z-[46] flex items-center justify-center gap-3.5">
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
            <p className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.26em] text-red-400">
              <span className="size-[5px] animate-hint rounded-full bg-red-400 shadow-[0_0_8px_1px_rgb(248_113_113/0.5)]" />
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
  selectedMemory?: string | null;
}) {
  return (
    <ConversationProvider>
      <VoiceCore {...props} />
    </ConversationProvider>
  );
}
