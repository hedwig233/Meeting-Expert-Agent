export function resolveModelConfig(env = process.env) {
  const requested = env.LLM_PROVIDER?.trim().toLowerCase();
  if (requested && !["openai", "openai_next", "deepseek", "qwen"].includes(requested)) throw new Error("LLM_PROVIDER 必须为 openai、openai_next、deepseek 或 qwen。");
  const provider = requested || (env.NEXT_API_KEY ? "openai_next" : env.OPENAI_API_KEY ? "openai" : env.DEEPSEEK_API_KEY ? "deepseek" : "qwen");
  if (provider === "openai_next") return { provider, apiKey: env.NEXT_API_KEY?.trim(), baseUrl: env.NEXT_BASE_URL || "https://api.openai-next.com/v1", model: env.NEXT_MODEL || "gpt-5.6-terra", reasoningEffort: env.NEXT_REASONING_EFFORT || "none" };
  if (provider === "openai") return { provider, apiKey: env.OPENAI_API_KEY?.trim(), baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1", model: env.OPENAI_MODEL || "gpt-5.6-terra", reasoningEffort: env.OPENAI_REASONING_EFFORT || "none" };
  if (provider === "deepseek") return { provider, apiKey: env.DEEPSEEK_API_KEY?.trim(), baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", model: env.DEEPSEEK_MODEL || "deepseek-chat" };
  return { provider, apiKey: env.QWEN_API_KEY?.trim(), baseUrl: env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1", model: env.QWEN_MODEL || "qwen-plus" };
}
