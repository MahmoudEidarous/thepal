const EXPLICIT_VOICE_EVENTS = new Set([
  "boundary",
  "feedback",
  "humor_user_reuse",
  "repair_accepted",
  "repair_failed",
]);

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function relationshipEventNeedsTranscriptEvidence(kind: string) {
  return EXPLICIT_VOICE_EVENTS.has(kind);
}

// Retrieved text and the voice model's own paraphrase can never become
// explicit user authority. Consent/feedback events need a short phrase that
// the browser can verify against the latest user transcript.
export function hasLatestUserTranscriptEvidence(
  kind: string,
  userEvidence: string | undefined,
  latestUserTurn: string,
) {
  if (!relationshipEventNeedsTranscriptEvidence(kind)) return true;
  const evidence = normalize(userEvidence ?? "");
  const transcript = normalize(latestUserTurn);
  return evidence.length > 0 && transcript.includes(evidence);
}
