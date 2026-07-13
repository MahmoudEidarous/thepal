export type MemoryFoundationMode = "off" | "shadow" | "required";

export function memoryFoundationMode(): MemoryFoundationMode {
  const configured = process.env.RECALL_MEMORY_FOUNDATION_MODE?.trim().toLowerCase();
  if (configured === "off" || configured === "shadow" || configured === "required") {
    return configured;
  }
  return "required";
}
