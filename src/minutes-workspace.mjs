const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value, fields) => object(value) && fields.every(field => typeof value[field] === 'string');
const optional = (value, field, type) => value[field] === undefined || typeof value[field] === type;
const stringArray = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const task = value => strings(value, ['id', 'title', 'description', 'owner', 'involvement', 'deadline', 'priority', 'sourceQuote', 'expertId', 'expertReason']) && typeof value.needsConfirmation === 'boolean' && optional(value, 'completed', 'boolean');
const expert = value => strings(value, ['id', 'key', 'name', 'description']);
const answer = value => strings(value, ['answerTitle', 'answerBody', 'action']) && stringArray(value.evidence) && (value.confidence === null || typeof value.confidence === 'number' && Number.isFinite(value.confidence));
const record = value => strings(value, ['id', 'text', 'displayText', 'context']) && expert(value.expert) && (value.task === null || task(value.task)) && ['loading', 'ready', 'error', 'cancelled'].includes(value.status)
  && (value.answer === undefined || answer(value.answer)) && (value.status !== 'ready' || answer(value.answer)) && optional(value, 'error', 'string') && optional(value, 'model', 'string') && optional(value, 'confirmed', 'boolean');

export function isMinutesWorkspace(value) {
  return strings(value, ['activeExpert', 'question', 'search', 'person', 'minutes', 'filename']) && value.version === 1 && ['tasks', 'discussion'].includes(value.tab)
    && (value.selectedTaskId === null || typeof value.selectedTaskId === 'string')
    && Array.isArray(value.tasks) && value.tasks.every(task) && Array.isArray(value.experts) && value.experts.every(expert)
    && Array.isArray(value.records) && value.records.every(record)
    && Array.isArray(value.discussion) && value.discussion.every(item => strings(item, ['id', 'text', 'taskTitle']) && (item.taskId === null || typeof item.taskId === 'string'))
    && (value.meeting === null || strings(value.meeting, ['title', 'summary', 'notice', 'minutes', 'person', 'model']) && stringArray(value.meeting.participants) && Array.isArray(value.meeting.tasks) && value.meeting.tasks.every(task));
}
