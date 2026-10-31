export function describeOpenAiError(error, apiKey, prefix = 'OpenAI 请求失败') {
  const redact = value => {
    let text = String(value ?? '');
    if (apiKey) text = text.split(apiKey).join('[密钥已隐藏]');
    return text.replace(/sk-[A-Za-z0-9_.*-]+/g, '[密钥已隐藏]').replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').slice(0, 500);
  };
  const parts = [redact(error?.code || error?.type), error?.param ? '参数：' + redact(error.param) : '', redact(error?.message)].filter(Boolean);
  return prefix + (parts.length ? '：' + parts.join('；') : '，服务未返回详细原因。');
}
