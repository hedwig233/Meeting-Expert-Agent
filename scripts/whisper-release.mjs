export function windowsCpuAsset(release) {
  if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) return null;
  const candidates = release.assets.filter(asset => {
    if (!/^whisper-bin-(?:(?:win(?:dows)?)-)?x64(?:-release)?\.zip$/i.test(asset.name || '')) return false;
    try {
      const url = new URL(asset.browser_download_url);
      return url.protocol === 'https:' && url.hostname === 'github.com' && /^\/(?:ggml-org|ggerganov)\/whisper\.cpp\/releases\/download\//i.test(url.pathname);
    } catch { return false; }
  });
  return candidates.find(asset => asset.name === 'whisper-bin-x64.zip') || candidates[0] || null;
}

export async function findWindowsRelease(fetchJson) {
  const latest = await fetchJson('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest');
  const latestAsset = windowsCpuAsset(latest);
  if (latestAsset) return { release: latest, asset: latestAsset };
  const history = await fetchJson('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=30');
  if (Array.isArray(history)) for (const release of history) {
    const asset = windowsCpuAsset(release); if (asset) return { release, asset };
  }
  const names = (latest.assets || []).map(asset => asset.name).slice(0, 12).join(', ') || '(none)';
  throw new Error('No official Windows x64 CPU package was found in the latest 30 releases. Latest release: ' + (latest.tag_name || '(unknown)') + '; assets: ' + names);
}
