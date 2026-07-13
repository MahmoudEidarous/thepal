import type {
  EventKind,
  MemorySource,
} from "./contracts";

export type SourceClassification = {
  eventKind: EventKind;
  source: MemorySource;
};

// The request's legacy source label is useful provenance, never authority by
// itself. This deterministic map is intentionally conservative and replayed.
export function classifyCaptureSource(legacySource: string): SourceClassification {
  const label = legacySource.trim().slice(0, 200) || "recall-app";
  const lower = label.toLowerCase();

  if (lower.startsWith("drop:")) {
    return {
      eventKind: "document_quote",
      source: { actor: "external", channel: "document", trust: "user_approved", label },
    };
  }
  if (lower.includes("recall-web") || lower.startsWith("web:")) {
    return {
      eventKind: "document_quote",
      source: { actor: "external", channel: "web", trust: "external_content", label },
    };
  }
  if (lower.includes("recall-dream") || lower.includes("night-shift")) {
    return {
      eventKind: "observation",
      source: { actor: "recall", channel: "agent", trust: "recall_observation", label },
    };
  }
  if (lower.includes("voice")) {
    return {
      eventKind: "utterance",
      source: { actor: "user", channel: "voice", trust: "user_direct", label },
    };
  }
  return {
    eventKind: "utterance",
    source: { actor: "user", channel: "text", trust: "user_direct", label },
  };
}
