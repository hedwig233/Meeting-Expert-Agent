import { createHash } from "node:crypto";

export const DOCUMENT_SCOPES = ["shared", "palace", "technical"];
const SAMPLE_SCOPES = { "sample-evidence-guide.md": "palace", "sample-order-api.md": "technical", "sample-incident.md": "technical", "sample-review-guide.md": "technical" };

// Existing uploads remain shared; only known bundled examples have inferred scopes.
export function documentScope(document) {
  return document.scope ?? SAMPLE_SCOPES[document.id] ?? "shared";
}

export function documentsForExpert(documents, expertRole = "architecture") {
  const scopes = { evidence: "palace", architecture: "technical" };
  if (!Object.hasOwn(scopes, expertRole)) throw new Error("未知专家角色。");
  const scope = scopes[expertRole];
  return documents.filter(document => ["shared", scope].includes(documentScope(document)));
}

// Small, inspectable local vector index: TF-IDF over Chinese bigrams and words.
export function tokenize(text) {
  const normalized = text.toLowerCase().replace(/idempotenc\w*/g, "幂等").replace(/retry/g, "重试");
  const result = normalized.match(/[a-z0-9_]{2,}/g) || [];
  for (const word of normalized.match(/[\u3400-\u9fff]+/g) || []) {
    if (word.length === 1) result.push(word);
    for (let i = 0; i < word.length - 1; i++) result.push(word.slice(i, i + 2));
  }
  return result;
}
export function chunkDocument(document) {
  const blocks = document.content.split(/\n(?=#{1,3} )/);
  return blocks.flatMap(block => {
    const heading = block.match(/^#{1,3}\s+(.+)/)?.[1] || document.title;
    const chunks = [];
    for (let offset = 0; offset < block.length; offset += 650) {
      const text = block.slice(offset, offset + 800);
      chunks.push({ id: createHash("sha256").update(document.id + heading + offset + text).digest("hex").slice(0, 14), documentId: document.id, title: document.title, heading, text, origin: document.origin });
    }
    return chunks;
  });
}
export function searchKnowledge(documents, query, limit = 4) {
  const chunks = documents.flatMap(chunkDocument);
  const tokenSets = chunks.map(c => new Set(tokenize(c.title + " " + c.text)));
  const terms = new Set(tokenize(query));
  if (!terms.size) return [];
  return chunks.map((chunk, i) => {
    let score = 0;
    for (const term of terms) if (tokenSets[i].has(term)) {
      const df = tokenSets.filter(set => set.has(term)).length;
      score += Math.log(1 + chunks.length / (1 + df));
    }
    return { ...chunk, score: score / Math.sqrt(Math.max(1, tokenSets[i].size)) };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
