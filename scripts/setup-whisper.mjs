import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute, basename } from 'node:path';
import { findWindowsRelease } from './whisper-release.mjs';
import { resumableDownload } from './resumable-download.mjs';
import { findCachedRuntime } from './whisper-cache.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'data', 'whisper'); mkdirSync(directory, { recursive: true });
const inside = path => { const rel = relative(directory, resolve(path)); if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Whisper target is outside its workspace.'); return path; };
const download = (url, destination, timeoutMs = 900000) => resumableDownload(url, destination, { timeoutMs, validatePath: inside });
function findCli(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'whisper-cli.exe') return join(path, entry.name);
    if (entry.isDirectory()) { const found = findCli(join(path, entry.name)); if (found) return found; }
  }
  return null;
}
try {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This setup script targets Windows x64. Configure WHISPER_BINARY and WHISPER_MODEL manually on other systems.');
  if (process.argv.includes('--vad-only')) {
    const vad = inside(join(directory, 'ggml-silero-v5.1.2.bin'));
    if (!existsSync(vad)) await download('https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin', vad);
    console.log('Local speech/noise detection model is ready. Restart the app to enable it.'); process.exit(0);
  }
  const manifestPath = join(directory, 'installation.json');
  const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const modelIndex = process.argv.indexOf('--model');
  const modelName = modelIndex >= 0 ? process.argv[modelIndex + 1] : existing?.model && basename(existing.model) === 'ggml-small.bin' ? 'small' : 'base';
  const models = { base: { size: 142, hash: '465707469ff3a37a2b9b8d8f89f2f99de7299dac' }, small: { size: 466, hash: '55356645c2b361a969dfd0ef2c5a50d530afd8d5' } };
  if (!models[modelName]) throw new Error('Use --model base or --model small.');
  if (existing && existsSync(existing.binary) && existsSync(existing.model) && basename(existing.model) === 'ggml-' + modelName + '.bin') { console.log('Local Whisper ' + modelName + ' is already installed.'); process.exit(0); }
  let cached = findCachedRuntime(directory);
  if (!cached) {
  const { release, asset } = await findWindowsRelease(async url => {
    const metadata = await fetch(url, { headers: { 'User-Agent': 'SEAT-local-whisper-setup' }, signal: AbortSignal.timeout(20000) });
    if (!metadata.ok) throw new Error('Unable to read official whisper.cpp releases: HTTP ' + metadata.status);
    return metadata.json();
  });
  const releaseName = String(release.tag_name).replace(/[^a-zA-Z0-9._-]/g, '_');
  const archive = inside(join(directory, releaseName + '-' + asset.name)); console.log('Downloading official whisper.cpp ' + release.tag_name + ' / ' + asset.name);
  if (!existsSync(archive)) await download(asset.browser_download_url, archive, 90000);
  if (asset.digest?.startsWith('sha256:')) { const hash = createHash('sha256').update(readFileSync(archive)).digest('hex'); if (hash !== asset.digest.slice(7)) throw new Error('Runtime archive checksum mismatch.'); }
  const runtime = inside(join(directory, 'runtime', releaseName));
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'extract-whisper.ps1'), '-Archive', archive, '-Destination', runtime], { windowsHide: true, timeout: 30000 });
  const binary = findCli(runtime); if (!binary) throw new Error('whisper-cli.exe was not present in the archive.');
  cached = { binary, release: release.tag_name };
  } else console.log('Using already-installed whisper.cpp ' + cached.release + '; no GitHub version query required.');
  const model = inside(join(directory, 'ggml-' + modelName + '.bin')); console.log('Preparing multilingual Whisper ' + modelName + ' (about ' + models[modelName].size + ' MiB).');
  if (!existsSync(model)) await download('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-' + modelName + '.bin', model);
  if (createHash('sha1').update(readFileSync(model)).digest('hex') !== models[modelName].hash) throw new Error('Model checksum mismatch.');
  writeFileSync(manifestPath, JSON.stringify({ binary: cached.binary, model, release: cached.release }, null, 2));
  console.log('Local Whisper is ready. Restart the app to enable transcription.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
