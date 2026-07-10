import { SPACES, type Space } from "./spaces";

export function asSpace(value: unknown): Space {
  return SPACES.includes(value as Space) ? (value as Space) : "personal";
}

export function apiError(err: unknown): Response {
  const message = err instanceof Error ? err.message : "unknown error";
  const down =
    message.includes("fetch failed") ||
    message.includes("ECONNREFUSED") ||
    message.includes("Connection error") ||
    message.includes("timed out") ||
    err instanceof DOMException ||
    message.includes("SUPERMEMORY_API_KEY");
  return Response.json(
    { error: down ? "supermemory-server is not reachable on " + (process.env.SUPERMEMORY_BASE_URL ?? "http://localhost:6767") : message },
    { status: down ? 503 : 500 },
  );
}
