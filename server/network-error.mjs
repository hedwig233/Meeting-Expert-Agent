export function describeNetworkFailure(error, url, prefix = '网络请求失败') {
  let host = ''; try { host = new URL(url).hostname; } catch {}
  const codes = new Set(); const visited = new Set();
  function walk(e) {
    if (!e || visited.has(e)) return; visited.add(e);
    if (typeof e.code === 'string') codes.add(e.code.replace(/[^A-Z0-9_]/gi, '').slice(0, 60));
    if (e.name === 'TimeoutError' || e.name === 'AbortError') codes.add(e.name);
    walk(e.cause); if (Array.isArray(e.errors)) e.errors.forEach(walk);
  }
  walk(error); const list = [...codes];
  let hint = '尚未收到服务器 HTTP 响应，请检查 API 域名的可访问性。';
  if (list.some(c => ['ENOTFOUND', 'EAI_AGAIN'].includes(c))) hint = '域名解析失败，请检查 DNS 或向平台确认 API 地址。';
  else if (list.some(c => /CERT|SELF_SIGNED|ISSUER|VERIFY/.test(c))) hint = 'TLS 证书校验失败，请检查系统时间与可信证书配置，保留证书校验。';
  else if (list.some(c => /TIMEDOUT|TIMEOUT|Timeout/.test(c))) hint = '连接超时，请确认当前网络能访问该 API 域名。';
  else if (list.includes('ECONNREFUSED')) hint = '连接被拒绝，请核对服务地址和代理配置。';
  else if (list.includes('ECONNRESET')) hint = '连接被重置，请检查网络或平台服务状态。';
  else if (list.some(c => ['EACCES', 'EPERM'].includes(c))) hint = '请求受到运行环境的网络权限限制。';
  return prefix + (host ? '（' + host + '）' : '') + '：' + (list.join(', ') || 'fetch failed') + '。' + hint;
}
