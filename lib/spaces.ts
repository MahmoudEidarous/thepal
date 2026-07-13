import { MEMORY_SPACES } from "./memory/contracts";

// "eval" is the quarantine space for adversarial test banks — never
// shown in the UI, never mixed into the personal graph. The persisted
// memory contract is now the single source for these values.
export const SPACES = MEMORY_SPACES;
export type Space = (typeof SPACES)[number];

export function spaceTag(space: Space): string {
  return `recall_${space}`;
}
