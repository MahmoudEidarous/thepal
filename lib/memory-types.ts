export type MemoryEntry = {
  id: string;
  memory: string;
  version: number;
  isStatic: boolean;
  isInference: boolean;
  createdAt: string;
  updatedAt: string;
  memoryRelations: Record<string, string>;
  history: Array<{ id: string; memory: string; version: number; createdAt: string }>;
};

export type ProcessingDoc = {
  id: string;
  status?: string | null;
  title?: string | null;
  content?: string | null;
  createdAt?: string;
};
