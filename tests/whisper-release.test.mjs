import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsCpuAsset, findWindowsRelease } from '../scripts/whisper-release.mjs';

const asset = (name = 'whisper-bin-x64.zip', owner = 'ggml-org') => ({ name, browser_download_url: 'https://github.com/' + owner + '/whisper.cpp/releases/download/v1/' + name });
test('Windows release selection handles the current name, Windows-prefixed names and the original repository owner', () => {
  assert(windowsCpuAsset({ assets: [asset()] }));
  assert(windowsCpuAsset({ assets: [asset('whisper-bin-Windows-x64.zip')] }));
  assert(windowsCpuAsset({ assets: [asset('whisper-bin-x64.zip', 'ggerganov')] }));
});
test('CPU installer does not select GPU-only, other architectures or untrusted download URLs', () => {
  assert.equal(windowsCpuAsset({ assets: [asset('whisper-bin-x64-cuda.zip'), asset('whisper-bin-ubuntu-x64.tar.gz'), asset('whisper-bin-win32.zip')] }), null);
  assert.equal(windowsCpuAsset({ assets: [{ name: 'whisper-bin-x64.zip', browser_download_url: 'https://example.invalid/whisper-bin-x64.zip' }] }), null);
  assert.equal(windowsCpuAsset({ prerelease: true, assets: [asset()] }), null);
});
test('installer falls back to a stable release with Windows binaries when latest has no Windows artifact', async () => {
  const requests = [];
  const selected = await findWindowsRelease(async url => {
    requests.push(url);
    return url.endsWith('/latest') ? { tag_name: 'newest', assets: [asset('whisper-bin-ubuntu-x64.tar.gz')] } : [{ tag_name: 'preview', prerelease: true, assets: [asset()] }, { tag_name: 'stable', assets: [asset()] }];
  });
  assert.equal(selected.release.tag_name, 'stable'); assert.equal(requests.length, 2);
});
test('unavailable packages produce useful release and asset diagnostics', async () => {
  await assert.rejects(() => findWindowsRelease(async url => url.endsWith('/latest') ? { tag_name: 'newest', assets: [asset('mac-only.zip')] } : []), /Latest release: newest; assets: mac-only.zip/);
});
