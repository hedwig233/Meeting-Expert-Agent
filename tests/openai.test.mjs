import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelConfig } from "../server/model-config.mjs";
import { modelExpert } from "../server/expert.mjs";

test("OpenAI selection overrides an older DeepSeek key and preserves explicit model selection", () => {
  const config = resolveModelConfig({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "openai-test", OPENAI_MODEL: "explicit-model", DEEPSEEK_API_KEY: "unused-test" });
  assert.equal(config.provider, "openai"); assert.equal(config.apiKey, "openai-test"); assert.equal(config.model, "explicit-model"); assert.equal(config.baseUrl, "https://api.openai.com/v1");
});
test("missing selected OpenAI key does not silently use another provider", () => {
  const config = resolveModelConfig({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "unused-test" });
  assert.equal(config.provider, "openai"); assert.equal(config.apiKey, "");
  assert.throws(() => resolveModelConfig({ LLM_PROVIDER: "invalid" }), /LLM_PROVIDER/);
});
test("Responses exchange retrieves source text, preserves reasoning context, and returns valid citations", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, "https://example.invalid/v1/responses");
    const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.model, "explicit-model"); assert.equal(body.max_tokens, undefined); assert.equal(body.temperature, undefined);
    assert.equal(body.text.format.type, "json_schema");
    if (calls === 1) {
      assert.equal(body.tool_choice.name, "search_company_docs");
      return Response.json({ status: "completed", output: [{ type: "reasoning", id: "r1", summary: [], encrypted_content: "test-encrypted" }, { type: "function_call", call_id: "c1", name: "search_company_docs", arguments: JSON.stringify({ query: "接口重试" }) }] });
    }
    const tool = body.input.find(item => item.type === "function_call_output"); assert.equal(tool.call_id, "c1");
    assert(body.input.some(item => item.type === "reasoning" && item.encrypted_content === "test-encrypted"));
    const sources = JSON.parse(tool.output); assert.equal(sources.length, 1);
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ contextSummary: "你们讨论接口重试", finding: "先确认幂等", impact: "可能重复执行", question: "当前实现是什么", proposal: "核对契约", confidence: "需确认", citationIds: [sources[0].id] }) }] }] });
  };
  try {
    const result = await modelExpert({ provider: "openai", apiKey: "test", baseUrl: "https://example.invalid/v1", model: "explicit-model", segments: [{ id: "s1", speaker: "A", text: "接口重试", start: 0, end: 1 }], question: "评审", documents: [{ id: "d1", title: "接口契约", origin: "test", content: "# 接口重试\n必须确认幂等。" }] });
    assert.equal(result.provider, "openai"); assert.equal(result.citations.length, 1); assert(result.citations[0].text.includes("幂等")); assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
test("incomplete Responses output is rejected instead of recorded as expert advice", async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => Response.json({ status: "incomplete", output: [] });
  try { await assert.rejects(() => modelExpert({ provider: "openai", apiKey: "test", baseUrl: "https://example.invalid/v1", model: "test", segments: [], question: "评审", documents: [] }), /输出未完成/); }
  finally { globalThis.fetch = original; }
});
