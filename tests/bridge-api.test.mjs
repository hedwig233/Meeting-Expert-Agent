import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createApplication } from "../server/app.mjs";
import { wavHeader } from "../server/asr.mjs";

test("bridge sessions retain selected role; speech accepts only fixed test text or existing meeting advice", async () => {
  let spoken;
  const app = createApplication({ root: fileURLToPath(new URL("..", import.meta.url)), database: ":memory:", config: { openaiApiKey: "test", asrProvider: "openai" }, speechSynthesizer: async args => { spoken = args.text; return { audio: wavHeader(0, 24000), format: "audio/wav" }; } });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port + "/api";
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const created = await post("/sessions", { title: "证据会议", expertRole: "evidence" }); const session = await created.json();
    assert.equal(session.expertRole, "evidence"); assert.equal(session.title, "证据会议");
    assert.equal((await post("/sessions", { expertRole: "arbitrary" })).status, 400);
    assert.equal((await post("/sessions/" + session.id + "/speech", { messageId: "unknown", text: "arbitrary" })).status, 400);
    const voice = await post("/sessions/" + session.id + "/speech", { test: true }); assert.equal(voice.status, 200); assert.equal(voice.headers.get("content-type"), "audio/wav"); assert(spoken.includes("人工智能会议专家"));
    await post("/sessions/" + session.id + "/segments", { text: "我们正在核对水样来源。" });
    const expert = await post("/sessions/" + session.id + "/expert", { question: "提出建议" }); const message = await expert.json();
    await post("/sessions/" + session.id + "/speech", { messageId: message.id }); assert(spoken.includes(message.finding));
    await post("/sessions/" + session.id + "/end", {});
    assert.equal((await post("/sessions/" + session.id + "/speech", { test: true })).status, 409);
    const config = await (await fetch(base + "/config")).json(); assert.equal(config.speech, true); assert.equal(config.openaiApiKey, undefined);
  } finally { await app.close(); }
});
