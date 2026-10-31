export interface Segment { id: string; speaker: string; text: string; start: number; end: number; source: 'sample' | 'dui' | 'openai' | 'local_whisper' | 'next_omni' | 'typed' }
export interface Source { id: string; documentId: string; title: string; heading: string; text: string; origin: string }
export interface ExpertMessage { id: string; request: string; question: string; mode: 'local' | 'qwen'; provider?: 'qwen' | 'deepseek' | 'openai' | 'openai_next'; contextSummary: string; finding: string; impact: string; proposal: string; confidence: string; citations: Source[]; basis: string; contextSegmentIds: string[]; contextSeconds: number; createdAt: string }
export interface Decision { id: string; messageId: string; text: string; before: string; owner: string; due: string }
export interface Session { id: string; title: string; status: 'active' | 'ended'; segments: Segment[]; messages: ExpertMessage[]; decisions: Decision[]; audioSeconds: number }
export interface Config { expert: 'local' | 'qwen'; asr: 'sample' | 'dui' | 'openai' | 'local' | 'next_omni'; asrReady?: boolean; asrModel?: string; model: string; sources: number }
export type KnowledgeScope = 'shared' | 'palace' | 'technical';
export interface Document { id: string; title: string; content: string; origin: string; scope: KnowledgeScope }
export interface Demo { duration: number; audio: string; segments: Segment[] }
