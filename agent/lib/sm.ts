// Raw Supermemory Local client for agent tools. Tools run in the app
// runtime with process.env access; no SDK needed for these endpoints.

const BASE = process.env.SUPERMEMORY_BASE_URL ?? "http://localhost:6767";

export const SPACES = ["personal", "work", "health"] as const;

export function spaceTag(space: string): string {
  return SPACES.includes(space as (typeof SPACES)[number])
    ? `recall_${space}`
    : "recall_personal";
}

export async function sm<T>(path: string, body: unknown, method = "POST"): Promise<T> {
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
