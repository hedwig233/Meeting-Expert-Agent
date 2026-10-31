import 'dotenv/config';
import { lookup } from 'node:dns/promises';
import { describeNetworkFailure } from '../server/network-error.mjs';

const base = new URL(process.env.NEXT_BASE_URL || 'https://api.openai-next.com/v1');
base.username = ''; base.password = ''; base.search = ''; base.hash = '';
console.log('只检查 DNS 和 HTTPS 连通性，不携带 API Key，不上传音频。');
console.log('代理环境变量是否存在：' + Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY));
try { const addresses = await lookup(base.hostname, { all: true }); console.log('DNS 成功：' + base.hostname + '，解析到 ' + addresses.length + ' 个地址。'); }
catch (error) { console.log(describeNetworkFailure(error, base, 'DNS 检查失败')); }
const endpoint = new URL(base); endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + '/models';
await Promise.all([endpoint, new URL('https://credits.openai-next.com/')].map(async url => {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(12000) }); console.log(url.hostname + '：HTTP ' + response.status + '，' + (response.headers.get('content-type') || 'unknown content type')); await response.body?.cancel(); }
  catch (error) { console.log(describeNetworkFailure(error, url, 'HTTPS 检查失败')); process.exitCode = 1; }
}));
