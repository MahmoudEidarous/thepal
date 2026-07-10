"use client";

import { useEffect, useRef, useState } from "react";
import { useEveAgent } from "eve/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Space } from "@/lib/spaces";

const SUGGESTIONS = [
  "What should I focus on today?",
  "What do you know about me?",
  "What have I committed to this week?",
];

const TOOL_LABELS: Record<string, string> = {
  search_memories: "searching memories",
  get_profile: "reading your profile",
  add_memory: "saving a memory",
  preview_forget: "previewing forget",
  execute_forget: "forgetting",
};

type AnyPart = {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  toolMetadata?: { eve?: { inputRequest?: { requestId: string; prompt?: string; options?: Array<{ id: string; label?: string }> } } };
};

function ToolChip({ part }: { part: AnyPart }) {
  const running = part.state === "input-streaming" || part.state === "input-available";
  const name = part.toolName ?? part.type.replace(/^tool-/, "");
  return (
    <span
      className={
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide " +
        (running
          ? "animate-pulse border-amber-200 bg-amber-50 text-amber-700"
          : "border-black/[0.07] bg-zinc-50 text-zinc-500")
      }
    >
      <span className={"size-[5px] rounded-full " + (running ? "bg-amber-400" : "bg-emerald-500")} />
      {running ? (TOOL_LABELS[name] ?? name) : name}
    </span>
  );
}

export function ChatPanel({ space }: { space: Space }) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const agent = useEveAgent({
    prepareSend: (turn) => ({ ...turn, clientContext: { space } }),
  });
  const busy = agent.status === "submitted" || agent.status === "streaming";
  const failed = agent.status === "error";

  // Pending human-in-the-loop approval (e.g. execute_forget), if any.
  const pendingRequest = agent.data.messages
    .at(-1)
    ?.parts.map((p) => (p as AnyPart).toolMetadata?.eve?.inputRequest)
    .find(Boolean);

  // Follow the conversation as it streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.data.messages, busy, pendingRequest]);

  function ask(text: string) {
    if (!text.trim() || busy) return;
    void agent.send({ message: text.trim() });
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <section className="card flex h-[clamp(420px,calc(100dvh-320px),640px)] flex-col p-5">
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        {agent.data.messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
            <p className="text-[15px] text-zinc-400">
              Ask anything — every answer is grounded in your memories.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="pill border border-black/[0.08] bg-white text-zinc-600 hover:border-black/[0.2] hover:text-zinc-900"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {agent.data.messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-[14.5px] leading-relaxed text-white">
                {m.parts.map((p, i) => ((p as AnyPart).type === "text" ? <span key={i}>{(p as AnyPart).text}</span> : null))}
              </div>
            ) : (
              <div className="flex max-w-[92%] flex-col gap-2">
                {m.parts.map((p, i) => {
                  const part = p as AnyPart;
                  if (part.type === "text" && part.text?.trim()) {
                    return (
                      <div key={i} className="md text-[14.5px] leading-relaxed text-zinc-800">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                      </div>
                    );
                  }
                  if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
                    return <ToolChip key={i} part={part} />;
                  }
                  return null;
                })}
              </div>
            )}
          </div>
        ))}

        {pendingRequest && (
          <div className="animate-rise rounded-xl border border-red-100 bg-red-50/60 p-4">
            <p className="mb-3 text-[13.5px] font-medium text-red-700">
              {pendingRequest.prompt ?? "The agent wants to permanently forget memories. Allow it?"}
            </p>
            <div className="flex gap-2">
              {(pendingRequest.options ?? [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }]).map((o) => (
                <button
                  key={o.id}
                  onClick={() =>
                    void agent.send({ inputResponses: [{ requestId: pendingRequest.requestId, optionId: o.id }] })
                  }
                  className={
                    "pill " +
                    (o.id === "approve" || /approve|yes/i.test(o.label ?? o.id)
                      ? "bg-red-600 text-white hover:opacity-85"
                      : "border border-black/[0.1] bg-white text-zinc-600 hover:border-black/[0.2]")
                  }
                >
                  {o.label ?? o.id}
                </button>
              ))}
            </div>
          </div>
        )}

        {busy && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
            thinking…
          </span>
        )}

        {failed && (
          <div className="rounded-xl bg-red-50 px-4 py-2.5 text-[13px] text-red-600">
            {agent.error?.message ?? "Something went wrong."} — try asking again.
          </div>
        )}
      </div>

      <form
        className="mt-4 flex items-center gap-2 border-t border-black/[0.05] pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your memory…"
          autoFocus
          className="flex-1 bg-transparent text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400"
        />
        <button
          type="submit"
          disabled={!input.trim() || busy}
          className="pill bg-zinc-900 px-5 py-2 text-white hover:opacity-85 disabled:opacity-30"
        >
          Ask
        </button>
      </form>
    </section>
  );
}
