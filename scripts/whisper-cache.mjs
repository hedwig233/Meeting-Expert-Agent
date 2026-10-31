import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export function findCachedRuntime(directory) {
  const runtime = join(directory, 'runtime'); if (!existsSync(runtime)) return null;
  function findCli(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name === 'whisper-cli.exe') return join(path, entry.name);
      if (entry.isDirectory()) { const result = findCli(join(path, entry.name)); if (result) return result; }
    }
    return null;
  }
  const binary = findCli(runtime); if (!binary) return null;
  const release = relative(runtime, binary).split(/[\\/]/)[0];
  return { binary, release };
}
