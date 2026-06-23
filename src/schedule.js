import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execa } from 'execa';

const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', 'com.claude.sharester.plist');
const PLIST_LABEL = 'com.claude.sharester';
const CRON_MARKER = '# claude-sharester';

export async function scheduleSync({ interval = '15m', method = 'launchagent' }) {
  const seconds = parseInterval(interval);
  const nodePath = process.execPath;
  const binPath = (await execa('which', ['claude-sharester'], { stdio: 'pipe' }).catch(() => null))?.stdout?.trim()
    ?? join(homedir(), '.npm', 'bin', 'claude-sharester');

  if (method === 'launchagent') {
    await installLaunchAgent(nodePath, binPath, seconds);
  } else {
    await installCron(nodePath, binPath, seconds);
  }
}

export async function unschedule() {
  let removed = false;
  if (existsSync(PLIST_PATH)) {
    try { await execa('launchctl', ['unload', PLIST_PATH], { stdio: 'pipe' }); } catch {}
    unlinkSync(PLIST_PATH);
    removed = true;
  }
  removed = (await removeCronEntry()) || removed;
  return removed;
}

export async function getScheduleStatus() {
  const hasLaunchAgent = existsSync(PLIST_PATH);
  const hasCron = await hasCronEntry();
  return { hasLaunchAgent, hasCron, plistPath: PLIST_PATH };
}

async function installLaunchAgent(nodePath, binPath, seconds) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${binPath}</string>
        <string>sync</string>
    </array>
    <key>StartInterval</key>
    <integer>${seconds}</integer>
    <key>StandardOutPath</key>
    <string>${join(homedir(), '.claude', 'skills', 'sharester.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(homedir(), '.claude', 'skills', 'sharester.log')}</string>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
`;
  if (existsSync(PLIST_PATH)) {
    try { await execa('launchctl', ['unload', PLIST_PATH], { stdio: 'pipe' }); } catch {}
  }
  writeFileSync(PLIST_PATH, plist, 'utf8');
  await execa('launchctl', ['load', PLIST_PATH], { stdio: 'pipe' });
}

async function installCron(nodePath, binPath, seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const logPath = join(homedir(), '.claude', 'skills', 'sharester.log');
  const cronLine = `*/${minutes} * * * * ${nodePath} ${binPath} sync >> ${logPath} 2>&1 ${CRON_MARKER}`;

  let existing = '';
  try {
    const { stdout } = await execa('crontab', ['-l'], { stdio: 'pipe' });
    existing = stdout;
  } catch {}

  const filtered = existing.split('\n').filter(l => !l.includes(CRON_MARKER)).join('\n');
  const updated = (filtered.trim() ? filtered.trim() + '\n' : '') + cronLine + '\n';
  await execa('crontab', ['-'], { input: updated, stdio: ['pipe', 'inherit', 'inherit'] });
}

async function removeCronEntry() {
  try {
    const { stdout } = await execa('crontab', ['-l'], { stdio: 'pipe' });
    const filtered = stdout.split('\n').filter(l => !l.includes(CRON_MARKER)).join('\n');
    await execa('crontab', ['-'], { input: filtered + '\n', stdio: ['pipe', 'inherit', 'inherit'] });
    return stdout.includes(CRON_MARKER);
  } catch {
    return false;
  }
}

async function hasCronEntry() {
  try {
    const { stdout } = await execa('crontab', ['-l'], { stdio: 'pipe' });
    return stdout.includes(CRON_MARKER);
  } catch {
    return false;
  }
}

function parseInterval(str) {
  const match = str.match(/^(\d+)(m|h|s)?$/i);
  if (!match) throw new Error(`Invalid interval "${str}". Use formats like 15m, 1h, 900s.`);
  const val = parseInt(match[1], 10);
  const unit = (match[2] || 'm').toLowerCase();
  return unit === 'h' ? val * 3600 : unit === 'm' ? val * 60 : val;
}
