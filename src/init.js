import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ZSHRC = join(homedir(), '.zshrc');
const BASHRC = join(homedir(), '.bashrc');

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function detectShellRc() {
  if (existsSync(ZSHRC)) return ZSHRC;
  if (existsSync(BASHRC)) return BASHRC;
  return ZSHRC;
}

function upsertExport(lines, key, value) {
  const pattern = new RegExp(`^\\s*export\\s+${key}=`);
  const idx = lines.findIndex(l => pattern.test(l));
  const exportLine = `export ${key}="${value}"`;
  if (idx !== -1) {
    lines[idx] = exportLine;
    return true;
  }
  return false;
}

export async function runInit() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\nSet up Jira credentials for claude-sharester scripts (owen-standup, owen-metrics).\n');
  console.log('Press Enter to accept the default shown in [brackets].\n');

  const baseUrl = (await ask(rl, 'JIRA_BASE_URL [https://covermymeds.atlassian.net]: ')).trim()
    || 'https://covermymeds.atlassian.net';

  const email = (await ask(rl, 'JIRA_EMAIL [robert.little@covermymeds.com]: ')).trim()
    || 'robert.little@covermymeds.com';

  let token = '';
  while (!token) {
    token = (await ask(rl, 'JIRA_API_TOKEN (generate at https://id.atlassian.com/manage-profile/security/api-tokens): ')).trim();
    if (!token) console.log('  API token is required.');
  }

  rl.close();

  const rcFile = detectShellRc();
  const existing = existsSync(rcFile) ? readFileSync(rcFile, 'utf8') : '';
  const lines = existing.split('\n');

  const updatedBase = upsertExport(lines, 'JIRA_BASE_URL', baseUrl);
  const updatedEmail = upsertExport(lines, 'JIRA_EMAIL', email);
  const updatedToken = upsertExport(lines, 'JIRA_API_TOKEN', token);

  if (!updatedBase || !updatedEmail || !updatedToken) {
    const missing = [];
    if (!updatedBase) missing.push(`export JIRA_BASE_URL="${baseUrl}"`);
    if (!updatedEmail) missing.push(`export JIRA_EMAIL="${email}"`);
    if (!updatedToken) missing.push(`export JIRA_API_TOKEN="${token}"`);
    lines.push('', '# Jira credentials for claude-sharester scripts', ...missing);
  }

  writeFileSync(rcFile, lines.join('\n'), 'utf8');

  console.log(`\nWrote credentials to ${rcFile}.`);
  console.log(`Run \`source ${rcFile}\` or open a new terminal for the changes to take effect.\n`);
}
