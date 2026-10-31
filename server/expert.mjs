import { searchKnowledge, documentsForExpert } from "./knowledge.mjs";
import { describeOpenAiError } from "./openai-error.mjs";
import { expertInstructions } from "./expert-prompts.mjs";

export function localExpert({ segments, question, documents, history = [], expertRole = "architecture" }) {
  documents = documentsForExpert(documents, expertRole);
  const discussion = segments.map(s => s.speaker + ": " + s.text).join("\n");
  const text = discussion + "\n" + question;
  const allSources = searchKnowledge(documents, text + (/重试|重复|幂等/.test(text) ? " 创建订单 幂等 重试 " : ""), 6);
  const source = allSources.find(s => s.heading.includes("创建订单") && s.text.includes("不支持幂等"));
  const incident = allSources.find(s => s.heading.includes("事故") && s.text.includes("重复"));
  if (expertRole === "architecture" && /重试|重复|幂等/.test(discussion) && source) {
    const fixed = /已实现幂等|已支持幂等|已经有幂等|已有幂等|已经实现.{0,6}幂等/.test(history.map(m => m.request || "").join("\n") + "\n" + question);
    return { mode: "local", contextSummary: "你们正在评审订单接口的失败重试方案。", finding: fixed ? "收到你的补充：当前实现已有幂等机制。这与检索到的演示接口文档存在版本差异，需要核对。" : "先确认一个前提：创建订单接口的文档明确写着不支持幂等，不能直接把超时等同于创建失败。", impact: fixed ? "不能仅依据旧文档继续认定当前接口不安全，也不能据此认定幂等已经验证通过。" : "如果请求已落库但响应超时，再次提交可能创建重复订单。", question: fixed ? "幂等键是否在重试时保持不变，并通过并发请求和超时场景测试？" : "当前链路是否已有幂等键或业务去重机制？如果有，对应的是哪一版接口？", proposal: fixed ? "核对当前接口版本，补充幂等契约及并发、超时测试，通过后再确定重试策略。" : "在确认幂等支持前，暂缓直接自动重试；先补充幂等设计、订单状态查询和超时场景测试，再评审重试策略。", confidence: "需确认当前实现", citations: [source, incident].filter(Boolean).map(({ score, ...s }) => s), basis: "本地规则演示：仅针对示例接口与讨论进行判断，不代表通用专家能力。" };
  }
  return { mode: "local", contextSummary: segments.length ? "我已接收到当前会议记录，但现有资料尚不足以支持一项具体评审结论。" : "还没有接收到会议内容。", finding: "目前不能确认存在设计问题。", impact: "资料不足时，不应把推测当成公司规则。", question: "请说明要评审的具体接口、预期行为和相关约束，或补充对应资料。", proposal: "先补齐依据，再判断是否需要修改方案。", confidence: "资料不足", citations: [], basis: "本地规则演示，未调用大模型。" };
}

export async function modelExpert({ segments, question, documents, history = [], signal, apiKey, baseUrl, model, provider = "qwen", reasoningEffort = "none", expertRole = "architecture" }) {
  documents = documentsForExpert(documents, expertRole);
  const sources = new Map();
  const instructions = expertInstructions(expertRole);
  const messages = [
    { role: "system", content: instructions },
    { role: "user", content: JSON.stringify({ meeting: segments.map(({ speaker, text, start, end }) => ({ speaker, text, start, end })), previousExpertExchanges: history.slice(-2).map(m => ({ request: m.request, finding: m.finding, proposal: m.proposal })), request: question || (expertRole === "evidence" ? "请评审当前证据和推理，指出最需要核实的条件。" : "请评审我们刚才讨论的方案。") }) }
  ];
  const tools = [{ type: "function", function: { name: "search_company_docs", description: "检索当前工作区允许访问的公司资料；返回原文与引用 ID。", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } } }];
  if (provider === "openai") return openaiExpert({ messages, tools, documents, signal, apiKey, baseUrl, model, reasoningEffort, instructions });
  for (let round = 0; round < 3; round++) {
    const firstChoice = provider === "deepseek" ? "required" : { type: "function", function: { name: "search_company_docs" } };
    const parameters = provider === 'openai_next' ? { max_completion_tokens: 2200, reasoning_effort: reasoningEffort } : { temperature: 0.2, max_tokens: 1600 };
    const response = await fetch(baseUrl.replace(/\/$/, "") + "/chat/completions", { method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, tools, tool_choice: round === 0 ? firstChoice : round === 2 ? "none" : "auto", ...parameters }), signal });
    if (!response.ok) { let error; try { error = (await response.json()).error; } catch {} throw new Error(describeOpenAiError(error, apiKey, "专家模型请求失败（HTTP " + response.status + "）")); }
    const body = await response.json();
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("模型没有返回有效消息。");
    if (message.tool_calls?.length) {
      if (message.tool_calls.length > 4) throw new Error("模型检索次数过多，请重试。");
      messages.push({ role: "assistant", content: message.content || null, tool_calls: message.tool_calls });
      for (const call of message.tool_calls) {
        if (call.function.name !== "search_company_docs") throw new Error("模型请求了不支持的工具。");
        let args; try { args = JSON.parse(call.function.arguments); } catch { throw new Error("模型检索参数无效。"); }
        if (typeof args.query !== "string") throw new Error("模型检索词无效。");
        const found = searchKnowledge(documents, args.query.slice(0, 1500));
        found.forEach(s => sources.set(s.id, s));
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(found) });
      }
      continue;
    }
    let result; try { result = JSON.parse(String(message.content).replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/, "")); } catch { throw new Error("模型返回格式无效，请重试。"); }
    for (const field of ["contextSummary", "finding", "impact", "question", "proposal", "confidence"]) if (typeof result[field] !== "string" || result[field].length > 5000) throw new Error("模型返回的评审结构不完整。");
    const ids = Array.isArray(result.citationIds) ? [...new Set(result.citationIds)] : [];
    if (ids.some(id => !sources.has(id))) throw new Error("模型引用了未检索到的资料，已拒绝展示该结论。");
    return { ...result, mode: "qwen", provider, citations: ids.map(id => { const { score, ...source } = sources.get(id); return source; }), basis: "专家建议，需由参会者核对和确认；引用可回溯至检索原文。" };
  }
  throw new Error("专家未在限定检索轮次内完成回答。");
}

// OpenAI Responses API. Keep the tool exchange stateless and validate citations.
async function openaiExpert({ messages, tools, documents, signal, apiKey, baseUrl, model, reasoningEffort, instructions }) {
  const sources = new Map();
  const fields = ["contextSummary", "finding", "impact", "question", "proposal", "confidence"];
  const input = messages.filter(m => m.role !== "system");
  const responseTools = tools.map(t => ({ type: "function", ...t.function, strict: true }));
  const schema = { type: "object", properties: { ...Object.fromEntries(fields.map(name => [name, { type: "string" }])), citationIds: { type: "array", items: { type: "string" } } }, required: [...fields, "citationIds"], additionalProperties: false };
  for (let round = 0; round < 3; round++) {
    const response = await fetch(baseUrl.replace(/\/$/, "") + "/responses", { method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model, instructions, input, tools: responseTools, tool_choice: round === 0 ? { type: "function", name: "search_company_docs" } : round === 2 ? "none" : "auto", reasoning: { effort: reasoningEffort }, max_output_tokens: 2200, store: false, include: ["reasoning.encrypted_content"], text: { format: { type: "json_schema", name: "meeting_expert_review", strict: true, schema } } }), signal });
    if (!response.ok) throw new Error("OpenAI 请求失败（HTTP " + response.status + "），请检查 API Key、模型权限及配置。");
    const body = await response.json();
    if (body.status === "incomplete") throw new Error("OpenAI 输出未完成，请调整推理强度或输出上限后重试。");
    if (!Array.isArray(body.output)) throw new Error("OpenAI 没有返回有效输出。");
    const calls = body.output.filter(item => item.type === "function_call");
    if (calls.length) {
      if (calls.length > 4) throw new Error("模型检索次数过多，请重试。");
      // Preserve reasoning items alongside calls when required by reasoning models.
      for (const item of body.output) {
        if (item.type === "reasoning") input.push({ type: "reasoning", id: item.id, summary: item.summary || [], ...(item.encrypted_content ? { encrypted_content: item.encrypted_content } : {}) });
        if (item.type === "function_call") input.push({ type: "function_call", call_id: item.call_id, name: item.name, arguments: item.arguments });
        if (item.type === "message") input.push({ role: "assistant", content: item.content.filter(c => c.type === "output_text").map(c => c.text).join("") });
      }
      for (const call of calls) {
        if (call.name !== "search_company_docs") throw new Error("模型请求了不支持的工具。");
        let args; try { args = JSON.parse(call.arguments); } catch { throw new Error("模型检索参数无效。"); }
        if (typeof args.query !== "string") throw new Error("模型检索词无效。");
        const found = searchKnowledge(documents, args.query.slice(0, 1500)); found.forEach(s => sources.set(s.id, s));
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(found) });
      }
      continue;
    }
    const content = body.output.filter(item => item.type === "message").flatMap(item => item.content || []);
    if (content.some(item => item.type === "refusal")) throw new Error("OpenAI 未提供本次评审回答。");
    let result; try { result = JSON.parse(content.filter(item => item.type === "output_text").map(item => item.text).join("")); } catch { throw new Error("OpenAI 返回格式无效。"); }
    for (const field of fields) if (typeof result[field] !== "string" || result[field].length > 5000) throw new Error("模型返回的评审结构不完整。");
    if (!Array.isArray(result.citationIds)) throw new Error("模型引用列表无效。");
    const ids = [...new Set(result.citationIds)];
    if (ids.some(id => !sources.has(id))) throw new Error("模型引用了未检索到的资料，已拒绝展示该结论。");
    return { ...result, mode: "qwen", provider: "openai", citations: ids.map(id => { const { score, ...source } = sources.get(id); return source; }), basis: "专家建议，需由参会者核对和确认；引用可回溯至检索原文。" };
  }
  throw new Error("专家未在限定检索轮次内完成回答。");
}
