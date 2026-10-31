import { wavHeader } from './asr.mjs';
import { describeOpenAiError } from './openai-error.mjs';
import { describeNetworkFailure } from './network-error.mjs';

export async function transcribeNextOmni({ pcm, apiKey, baseUrl = 'https://api.openai-next.com/v1', model = 'qwen3-omni-flash', signal, hint = '', onPartial = () => {}, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('请配置 NEXT_API_KEY。');
  if (!pcm.length || pcm.length % 2) throw new Error('请输入有效 PCM16 音频。');
  if (pcm.length > 2 * 1024 * 1024) throw new Error('单段音频过长，请缩短分段。');
  const wav = Buffer.concat([wavHeader(pcm.length), pcm]);
  const prompt = '请只将音频中实际说出的中文逐字转写为简体中文。不总结、不回答、不添加解释或标题。不要根据常识补全内容。无法听清则只输出[听不清]。没有人声则输出空字符串。' + (hint ? '术语提示仅用于识别，不表示这些词一定出现：' + hint.slice(0, 240) : '');
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const response = await fetchImpl(url, { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,' + wav.toString('base64'), format: 'wav' } }, { type: 'text', text: prompt }] }], modalities: ['text'], stream: true, enable_thinking: false }), signal }).catch(error => { throw new Error(describeNetworkFailure(error, url, 'Next 音频连接失败')); });
  if (!response.ok) { let error; try { error = (await response.json()).error; } catch {} throw new Error(describeOpenAiError(error, apiKey, 'Next Qwen 音频请求失败（HTTP ' + response.status + '）')); }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Next 没有返回所需的音频流式文本响应，请确认平台透传 Qwen Omni 音频参数。');
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = '', eventLines = [], text = '', completed = false;
  function processEvent() {
    if (!eventLines.length) return; const data = eventLines.join('\n'); eventLines = [];
    if (data.trim() === '[DONE]') { completed = true; return; }
    let event; try { event = JSON.parse(data); } catch { throw new Error('Next 返回了无效的流式消息。'); }
    if (event.error) throw new Error(describeOpenAiError(event.error, apiKey, 'Next 音频转写失败'));
    const choice = event.choices?.[0]; if (!choice) return;
    if (choice.finish_reason === 'length') throw new Error('音频转写结果被截断，未加入会议上下文。');
    if (choice.finish_reason === 'stop') completed = true;
    if (typeof choice.delta?.content === 'string') { text += choice.delta.content; if (text.length > 8000) throw new Error('模型输出过长，未将其作为转写结果。'); onPartial(text); }
  }
  function processLine(line) { line = line.replace(/\r$/, ''); if (!line) processEvent(); else if (line.startsWith('data:')) eventLines.push(line.slice(5).trimStart()); }
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      let index; while ((index = buffer.indexOf('\n')) >= 0) { processLine(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    }
    buffer += decoder.decode(); if (buffer) processLine(buffer); processEvent();
    if (!completed) throw new Error('转写连接在完成前中断，未将半截结果加入上下文。');
  } finally { reader.releaseLock(); }
  text = text.trim(); return { text, confidence: null, accepted: Boolean(text) && text !== '[听不清]' };
}
