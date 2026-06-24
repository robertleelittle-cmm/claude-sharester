import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { loadConfig, saveConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(__dirname, '..');
const localVersion = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const REMOTE_PKG_URL =
  'https://raw.githubusercontent.com/robertleelittle-cmm/claude-sharester/main/package.json';

export async function checkForUpdates() {
  try {
    const config = loadConfig();
    const now = Date.now();
    if (now - (config.lastVersionCheck ?? 0) < CHECK_INTERVAL_MS) return;

    const res = await fetch(REMOTE_PKG_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;

    const { version: remoteVersion } = await res.json();

    config.lastVersionCheck = now;
    saveConfig(config);

    if (isNewer(remoteVersion, localVersion)) {
      const updateCmd = existsSync(join(pkgDir, '.git'))
        ? `git -C ${pkgDir} pull`
        : 'npm install -g claude-sharester';
      console.log(
        chalk.yellow(`\n  Update available: ${localVersion} → ${remoteVersion}`) +
        chalk.dim(`\n  Run: ${updateCmd}\n`)
      );
    }
  } catch {
    // Network unavailable or timeout — silently skip
  }
}

function isNewer(remote, local) {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}
