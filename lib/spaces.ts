// "eval" is the quarantine space for adversarial test banks — never
// shown in the UI, never mixed into the personal graph
export const SPACES = ["personal", "work", "health", "eval"] as const;
export type Space = (typeof SPACES)[number];

export function spaceTag(space: Space): string {
  return `recall_${space}`;
}
