import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DOCUMENT_SCOPES, documentScope } from "./knowledge.mjs";

export function createStore(root, database = join(root, "data", "seat.sqlite")) {
  mkdirSync(join(root, "data"), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, payload TEXT NOT NULL);");
  const putSession = db.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?)");
  const putDocument = db.prepare("INSERT OR REPLACE INTO documents VALUES (?, ?)");
  for (const file of readdirSync(join(root, "knowledge")).filter(f => f.endsWith(".md"))) {
    const id = "sample-" + file;
    if (!db.prepare("SELECT id FROM documents WHERE id = ?").get(id)) {
      const content = readFileSync(join(root, "knowledge", file), "utf8");
      putDocument.run(id, JSON.stringify({ id, title: content.match(/^# (.+)/m)?.[1] || file, content, scope: documentScope({ id }), origin: "演示资料", createdAt: new Date().toISOString() }));
    }
  }
  return {
    createSession(options = {}) { const s = { id: randomUUID(), title: options.title || "订单服务 · 技术方案评审", expertRole: options.expertRole || "architecture", createdAt: new Date().toISOString(), status: "active", segments: [], messages: [], decisions: [], audioSeconds: 0 }; this.save(s); return s; },
    get(id) { const row = db.prepare("SELECT payload FROM sessions WHERE id = ?").get(id); return row ? JSON.parse(row.payload) : null; },
    save(session) { putSession.run(session.id, JSON.stringify(session)); },
    documents() { return db.prepare("SELECT payload FROM documents").all().map(row => { const d = JSON.parse(row.payload); return { ...d, scope: documentScope(d) }; }); },
    addDocument(title, content, scope = "shared") { if (!DOCUMENT_SCOPES.includes(scope)) throw new Error("未知知识范围。"); const d = { id: randomUUID(), title, content, scope, origin: "本地上传", createdAt: new Date().toISOString() }; putDocument.run(d.id, JSON.stringify(d)); return d; },
    setDocumentScope(id, scope) {
      if (!DOCUMENT_SCOPES.includes(scope)) throw new Error("未知知识范围。");
      const row = db.prepare("SELECT payload FROM documents WHERE id = ?").get(id);
      if (!row) return null;
      const document = { ...JSON.parse(row.payload), scope };
      putDocument.run(id, JSON.stringify(document)); return document;
    },
    close() { db.close(); }
  };
}
