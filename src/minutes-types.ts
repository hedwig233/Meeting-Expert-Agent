export type Task = { id: string; title: string; description: string; owner: string; involvement: string; deadline: string; priority: string; sourceQuote: string; expertId: string; expertReason: string; needsConfirmation: boolean; completed?: boolean };
export type Meeting = { title: string; summary: string; participants: string[]; tasks: Task[]; notice: string; minutes: string; person: string; model: string };
export type Expert = { id: string; key: string; name: string; description: string };
export type Answer = { answerTitle: string; answerBody: string; evidence: string[]; action: string; confidence: number | null };
export type Record = { id: string; expert: Expert; task: Task | null; text: string; displayText: string; context: string; status: 'loading' | 'ready' | 'error' | 'cancelled'; answer?: Answer; error?: string; model?: string; confirmed?: boolean };
export type Discussion = { id: string; text: string; taskTitle: string; taskId: string | null };
export type MinutesWorkspace = { version: 1; meeting: Meeting | null; tasks: Task[]; selectedTaskId: string | null; experts: Expert[]; activeExpert: string; records: Record[]; discussion: Discussion[]; question: string; search: string; tab: 'tasks' | 'discussion'; person: string; minutes: string; filename: string };
