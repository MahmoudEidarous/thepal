import Supermemory from "supermemory";

// Server-side only — the sm_ key must never reach the browser.
export const supermemory = new Supermemory({
  apiKey: process.env.SUPERMEMORY_API_KEY!,
  baseURL: process.env.SUPERMEMORY_BASE_URL ?? "http://localhost:6767",
});

// Every write and search must carry a containerTag or all data
// collapses into one bucket. Spaces are our containerTags.
export const SPACES = ["personal", "work", "health"] as const;
export type Space = (typeof SPACES)[number];

export function spaceTag(space: Space): string {
  return `recall_${space}`;
}
