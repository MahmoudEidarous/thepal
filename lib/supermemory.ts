import Supermemory from "supermemory";

// Server-side only — the sm_ key must never reach the browser.
export const supermemory = new Supermemory({
  apiKey: process.env.SUPERMEMORY_API_KEY!,
  baseURL: process.env.SUPERMEMORY_BASE_URL ?? "http://localhost:6767",
});

export { SPACES, spaceTag } from "./spaces";
export type { Space } from "./spaces";

const BASE = process.env.SUPERMEMORY_BASE_URL ?? "http://localhost:6767";

// For engine endpoints the SDK doesn't type yet (v4 memories list/forget).
export async function smRequest<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SUPERMEMORY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`supermemory ${path} ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export const smPost = <T,>(path: string, body: unknown) => smRequest<T>("POST", path, body);
