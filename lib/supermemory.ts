import Supermemory from "supermemory";

// Server-side only — the sm_ key must never reach the browser.
export const supermemory = new Supermemory({
  apiKey: process.env.SUPERMEMORY_API_KEY!,
  baseURL: process.env.SUPERMEMORY_BASE_URL ?? "http://localhost:6767",
});

export { SPACES, spaceTag } from "./spaces";
export type { Space } from "./spaces";
