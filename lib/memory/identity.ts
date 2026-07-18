import type { MemoryEvent, MemorySpace } from "./contracts";
import type { MemoryEventLedger } from "./event-ledger";

const NAME_PREFIX =
  /(?:^|[.!?]\s+)(?:my name is|i(?:'m| am) called|you can call me|call me|the user(?:'s|’s) name is|user(?:'s|’s) name is)\s+([^.!?,;:\n]{1,100})/i;
const NON_NAME = /^(?:back|later|maybe|now|tomorrow|tonight|whenever|when|if|about)\b/i;

/**
 * Identity is too important to leave entirely to an open-ended extractor.
 * This intentionally recognizes only explicit self-identification language;
 * it never guesses a name from a person mention or imported document.
 */
export function explicitUserNameFromText(text: string) {
  const match = text.normalize("NFKC").match(NAME_PREFIX);
  if (!match?.[1]) return null;
  const candidate = match[1]
    .split(/\s+(?:and|but|because|so|though)\s+/i, 1)[0]
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !candidate ||
    candidate.length > 80 ||
    NON_NAME.test(candidate) ||
    /\d|https?:|@/.test(candidate) ||
    candidate.split(/\s+/).length > 6
  ) {
    return null;
  }
  return candidate;
}

export type CurrentUserIdentityName = {
  name: string;
  eventId: string;
  recordedAt: string;
};

export function currentUserIdentityName(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
): CurrentUserIdentityName | null {
  return ledger
    .listActiveEvents(userId, space)
    .filter(
      (event) =>
        event.source.actor === "user" &&
        (event.source.trust === "user_direct" || event.source.trust === "user_approved"),
    )
    .sort((left, right) =>
      right.recordedAt.localeCompare(left.recordedAt) || right.id.localeCompare(left.id),
    )
    .map((event: MemoryEvent) => ({ event, name: explicitUserNameFromText(event.payload.content) }))
    .filter((item): item is { event: MemoryEvent; name: string } => !!item.name)
    .map(({ event, name }) => ({ name, eventId: event.id, recordedAt: event.recordedAt }))[0] ?? null;
}
