import { createOpenRouter } from "@openrouter/ai-sdk-provider";

export const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Cost policy: pro for reasoning surfaces (chat agent, dreaming),
// flash for high-volume classification (commitments).
export const MODEL_PRO = "deepseek/deepseek-v4-pro";
export const MODEL_FLASH = "deepseek/deepseek-v4-flash";
