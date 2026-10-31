import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import WebSocket from "ws";
import { createApplication } from "../server/app.mjs";
import { searchKnowledge } from "../server/knowledge.mjs";
import { localExpert, modelExpert } from "../server/expert.mjs";
import { wavHeader } from "../server/asr.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const documents = ["order-api.md", "incident.md", "review-guide.md"].map(id => ({ id, title: id, origin: "test", content: readFileSync(join(root, "knowledge", id), "utf8") }));
const segments = [{ id: "s1", speaker: "小林", text: "创建订单超时之后，客户端自动重试三次。", start: 0, end: 5 }];

test("retrieval returns original company evidence and stable citation IDs", () => {
  const found = searchKnowledge(documents, "创建订单 重试 幂等", 6);
  assert(found.some(s => s.text.includes("不支持幂等")));
  assert.deepEqual(found.map(s => s.id), searchKnowledge(documents, "创建订单 重试 幂等", 6).map(s => s.id));
  assert.equal(searchKnowledge(documents, "zzzznonexistenttoken").length, 0);
});
test("local demonstration identifies the seeded risk with evidence, but abstains on unrelated topics", () => {
  const answer = localExpert({ segments, question: "请评审", documents });
  assert.equal(answer.mode, "local"); assert(answer.finding.includes("不支持幂等")); assert(answer.citations.length);
  const insufficient = localExpert({ segments: [{ text: "我们讨论办公室装饰", speaker: "A" }], question: "怎么做", documents });
  assert.equal(insufficient.confidence, "资料不足"); assert.equal(insufficient.citations.length, 0);
});
test("a participant correction changes the assessment instead of repeating an obsolete claim", () => {
  const answer = localExpert({ segments, question: "我们已经实现幂等", documents });
  assert(answer.finding.includes("版本差异")); assert(answer.proposal.includes("核对当前接口版本"));
});
test("model adapter performs real tool exchange and rejects invented citation IDs", async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    if (calls === 1) return Response.json({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "tool-1", type: "function", function: { name: "search_company_docs", arguments: JSON.stringify({ query: "创建订单 幂等" }) } }] } }] });
    assert(body.messages.some(m => m.role === "tool" && m.tool_call_id === "tool-1"));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ contextSummary: "当前讨论重试", finding: "发现风险", impact: "重复订单", question: "有幂等吗", proposal: "先确认", confidence: "需确认", citationIds: ["fabricated-id"] }) } }] });
  };
  try { await assert.rejects(() => modelExpert({ segments, question: "评审", documents, apiKey: "test", baseUrl: "https://example.invalid", model: "test" }), /未检索到/); assert.equal(calls, 2); }
  finally { globalThis.fetch = originalFetch; }
});
test("PCM WAV header describes mono 16kHz signed 16-bit audio", () => {
  const h = wavHeader(32000); assert.equal(h.toString("ascii", 0, 4), "RIFF"); assert.equal(h.readUInt32LE(24), 16000); assert.equal(h.readUInt16LE(22), 1); assert.equal(h.readUInt16LE(34), 16);
});

test("meeting API and audio stream preserve context boundaries, confirmation and session isolation", async () => {
  const application = createApplication({ root, database: ":memory:" });
  await new Promise(resolve => application.server.listen(0, "127.0.0.1", resolve));
  const port = application.server.address().port;
  const base = "http://127.0.0.1:" + port;
  const request = async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(base + "/api" + path, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  let socket;
  try {
    const { data: session } = await request("/sessions", {});
    assert.equal((await request("/sessions/" + session.id + "/expert", {})).status, 400);
    socket = new WebSocket("ws://127.0.0.1:" + port + "/ws/meeting?session=" + session.id);
    await once(socket, "open");
    const fixture = JSON.parse(readFileSync(join(root, "public/demo/meeting.json"), "utf8"));
    const waitSync = () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off("message", listener); reject(new Error("sync timeout")); }, 3000);
      function listener(raw) { if (JSON.parse(raw.toString()).type === "stream.synced") { clearTimeout(timeout); socket.off("message", listener); resolve(); } }
      socket.on("message", listener); socket.send(JSON.stringify({ type: "stream.sync" }));
    });
    socket.send(JSON.stringify({ type: "stream.start", mode: "sample" }));
    socket.send(JSON.stringify({ type: "sample.progress", time: fixture.duration }));
    await waitSync();
    assert.equal((await request("/sessions/" + session.id)).data.segments.length, 0, "future subtitles must not appear without streamed audio");
    const seconds = fixture.segments[1].end + 0.15;
    let remaining = Math.ceil(seconds * 32000 / 2) * 2;
    while (remaining > 0) { const size = Math.min(16000, remaining); socket.send(Buffer.alloc(size)); remaining -= size; }
    socket.send(JSON.stringify({ type: "sample.progress", time: seconds })); await waitSync();
    const state = (await request("/sessions/" + session.id)).data;
    assert.equal(state.segments.length, 2); assert(state.segments.every(s => s.source === "sample"));
    const result = await request("/sessions/" + session.id + "/expert", { question: "帮我们评审" });
    assert.equal(result.status, 200); assert.equal(result.data.contextSegmentIds.length, 2); assert.equal(result.data.request, "帮我们评审"); assert(result.data.question.includes("幂等"));
    assert.equal((await request("/sessions/" + session.id)).data.decisions.length, 0, "expert advice must not become an automatic decision");
    const confirmed = await request("/sessions/" + session.id + "/decisions", { messageId: result.data.id, text: "先完善幂等设计，再评审重试策略。" });
    assert.equal(confirmed.status, 201); assert.equal(confirmed.data.owner, "待确认"); assert.equal(confirmed.data.due, "待确认");
    assert.equal((await request("/sessions/" + session.id + "/decisions", { messageId: result.data.id, text: "重复" })).status, 409);
    const { data: second } = await request("/sessions", {}); assert.equal(second.segments.length, 0); assert.equal(second.messages.length, 0);
    assert.equal((await request("/sessions/" + second.id + "/expert", {})).status, 400);
    const exported = await fetch(base + "/api/sessions/" + session.id + "/export"); const markdown = await exported.text(); assert(markdown.includes("先完善幂等设计")); assert(markdown.includes("示例"));
    await request("/sessions/" + session.id + "/end", {});
    assert.equal((await request("/sessions/" + session.id + "/segments", { text: "新消息" })).status, 409);
    const crossOrigin = await fetch(base + "/api/sessions", { method: "POST", headers: { Origin: "https://unrelated.invalid" } }); assert.equal(crossOrigin.status, 403);
    assert.equal((await request("/documents", { title: "", content: "x" })).status, 400);
    assert.equal((await request("/documents", { title: "团队规范", content: "# 团队规范\n先确认再发布。" })).status, 201);
  } finally { socket?.terminate(); await application.close(); }
});
