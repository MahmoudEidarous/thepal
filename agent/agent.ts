import { defineAgent } from "eve";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default defineAgent({
  model: openrouter("deepseek/deepseek-v4-pro"),
  // Direct LanguageModels have no AI Gateway catalog metadata, so the
  // context window must be declared for compaction to compile.
  modelContextWindowTokens: 131_072,
});
