export const SPACES = ["personal", "work", "health"] as const;
export type Space = (typeof SPACES)[number];

export function spaceTag(space: Space): string {
  return `recall_${space}`;
}
