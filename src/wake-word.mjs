export function normalizeWakeText(text) {
  const variants = { '請': '请', '醫': '医', '發': '发', '專': '专', '體': '体', '幫': '帮', '聽': '听', '說': '说', '講': '讲' };
  return text.replace(/[請醫發專體幫聽說講]/g, c => variants[c]).replace(/[\s，。！？、,.!?]/g, '');
}
export function containsWakeCommand(text, command) { return Boolean(command.trim()) && normalizeWakeText(text).includes(normalizeWakeText(command)); }
