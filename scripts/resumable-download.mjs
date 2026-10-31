import { createWriteStream, existsSync, statSync, renameSync } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function resumableDownload(url, destination, { timeoutMs = 900000, fetchImpl = fetch, log = console.log, validatePath = path => path } = {}) {
  validatePath(destination); const part = validatePath(destination + '.part');
  let offset = existsSync(part) ? statSync(part).size : 0;
  if (offset) log('Resuming existing download at ' + Math.round(offset / 1024 / 1024) + ' MiB.');
  const headers = { 'User-Agent': 'SEAT-local-whisper-setup', 'Accept-Encoding': 'identity' };
  if (offset) headers.Range = 'bytes=' + offset + '-';
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 416) {
      const total = response.headers.get('content-range')?.match(/^bytes \*\/(\d+)$/)?.[1];
      await response.body?.cancel();
      if (total && offset === Number(total)) { renameSync(part, destination); return; }
      throw new Error('The partial file does not match the remote file size.');
    }
    if (!response.ok) throw new Error('Download failed: HTTP ' + response.status + ' from ' + new URL(url).hostname);
    let expectedTotal;
    if (response.status === 206) {
      const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!range || Number(range[1]) !== offset) { await response.body?.cancel(); throw new Error('The download server returned an unexpected resume range. Partial file preserved.'); }
      expectedTotal = Number(range[3]);
    } else {
      if (offset) log('The server did not accept resume; restarting this file download.');
      offset = 0;
      const size = response.headers.get('content-length'); if (size) expectedTotal = Number(size);
    }
    let bytes = offset, last = Date.now();
    const progress = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; if (Date.now() - last > 10000) { log('Downloaded ' + Math.round(bytes / 1024 / 1024) + ' MiB'); last = Date.now(); } callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(part, { flags: offset ? 'a' : 'w' }));
    if (expectedTotal !== undefined && statSync(part).size !== expectedTotal) throw new Error('The download is incomplete; run the same command to resume.');
    renameSync(part, destination);
  } catch (error) {
    const saved = existsSync(part) ? Math.round(statSync(part).size / 1024 / 1024) : 0;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('Download timed out. Retained ' + saved + ' MiB in the .part file; rerun to resume.');
    throw error;
  }
}
