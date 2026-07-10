import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync } from 'fs';
import { join, basename, extname } from 'path';
import { execa } from 'execa';
import { getSkillsDir, getScriptsDir } from '../config.js';

export async function syncGithub(source) {
  const cloneDir = join(getSkillsDir(), source.id);
  const { overrideCleared } = await resolveCheckout(source, cloneDir);

  const scriptsPath = resolveRepoDir(cloneDir, 'scripts');
  const scripts = discoverFiles(scriptsPath)
    .map(filePath => ({ scriptName: basename(filePath), filePath }));

  const scriptNames = new Set(scripts.map(s => s.scriptName));

  const commandsPath = resolveRepoDir(cloneDir, 'commands');
  const commands = [];
  const skills = [];
  for (const filePath of discoverFiles(commandsPath, '.md')) {
    const processed = rewriteScriptRefs(filePath, source.prefix, scriptNames, cloneDir);
    const content = readFileSync(processed, 'utf8');
    const skillName = extractSkillName(content);
    if (skillName) {
      skills.push({ skillName, filePath: processed });
    } else {
      commands.push({ commandName: basename(filePath), filePath: processed });
    }
  }

  // Pick up any SKILL.md files anywhere in the repo (handles flat skills/ dirs
  // and deeply nested structures like src/plugins/<plugin>/skills/<name>/SKILL.md)
  for (const skillFile of findSkillFiles(cloneDir)) {
    const content = readFileSync(skillFile, 'utf8');
    const skillName = extractSkillName(content) ?? basename(skillFile.replace(/\/SKILL\.md$/, ''));
    skills.push({ skillName, filePath: skillFile });
  }

  return { commands, skills, scripts, cloneDir, overrideCleared };
}

// Checks out the right ref for the source: override branch if set and still
// exists on the remote, otherwise origin/main. Returns { overrideCleared }.
async function resolveCheckout(source, cloneDir) {
  const isNew = !existsSync(cloneDir);
  if (isNew) {
    await execa('git', ['clone', source.url, cloneDir], { stdio: 'pipe' });
  }

  const override = source.override;
  if (override) {
    const remoteUrl = override.remote ?? source.url;
    const { stdout } = await execa(
      'git', ['ls-remote', '--heads', remoteUrl, override.branch],
      { stdio: 'pipe' }
    ).catch(() => ({ stdout: '' }));

    if (!stdout.trim()) {
      await checkoutMain(cloneDir);
      return { overrideCleared: true };
    }

    // Ensure the override remote exists in the cloned repo
    const remoteName = remoteUrl === source.url ? 'origin' : '_branch_override';
    if (remoteName !== 'origin') {
      const existing = await execa('git', ['-C', cloneDir, 'remote'], { stdio: 'pipe' })
        .then(r => r.stdout.split('\n'))
        .catch(() => []);
      if (existing.includes(remoteName)) {
        await execa('git', ['-C', cloneDir, 'remote', 'set-url', remoteName, remoteUrl], { stdio: 'pipe' });
      } else {
        await execa('git', ['-C', cloneDir, 'remote', 'add', remoteName, remoteUrl], { stdio: 'pipe' });
      }
    }

    await execa('git', ['-C', cloneDir, 'fetch', remoteName, override.branch], { stdio: 'pipe' });
    await execa('git', ['-C', cloneDir, 'checkout', '--detach', `${remoteName}/${override.branch}`], { stdio: 'pipe' });
    return { overrideCleared: false };
  }

  if (!isNew) {
    await checkoutMain(cloneDir);
  }
  return { overrideCleared: false };
}

async function checkoutMain(cloneDir) {
  try {
    await execa('git', ['-C', cloneDir, 'checkout', 'main'], { stdio: 'pipe' });
  } catch {
    await execa('git', ['-C', cloneDir, 'checkout', 'master'], { stdio: 'pipe' });
  }
  await execa('git', ['-C', cloneDir, 'pull', '--ff-only'], { stdio: 'pipe' });
}

// Rewrites `node .claude/scripts/<name>` in command files to use the absolute
// symlinked path `~/.claude/scripts/<prefix>-<name>`. Writes the result to
// <cloneDir>/.processed/commands/<file> so the git working tree is untouched.
// Returns the processed path if any rewrites were made, otherwise the original.
function rewriteScriptRefs(filePath, prefix, scriptNames, cloneDir) {
  if (scriptNames.size === 0) return filePath;

  const content = readFileSync(filePath, 'utf8');
  const scriptsDir = getScriptsDir();

  const rewritten = content.replace(
    /node\s+\.claude\/scripts\/([^\s"'`]+)/g,
    (match, scriptFile) => {
      if (!scriptNames.has(scriptFile)) return match;
      return `node ${join(scriptsDir, `${prefix}-${scriptFile}`)}`;
    }
  );

  if (rewritten === content) return filePath;

  const processedDir = join(cloneDir, '.processed', 'commands');
  if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });
  const processedPath = join(processedDir, basename(filePath));
  writeFileSync(processedPath, rewritten, 'utf8');
  return processedPath;
}

function extractSkillName(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
  return nameMatch?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null;
}

// Returns .claude/<subdir> if it exists, otherwise <subdir> at repo root.
// discoverFiles handles the non-existent case by returning [].
function resolveRepoDir(cloneDir, subdir) {
  const dotClaudePath = join(cloneDir, '.claude', subdir);
  if (existsSync(dotClaudePath)) return dotClaudePath;
  return join(cloneDir, subdir);
}

const SKIP_DIRS = new Set(['.git', '.processed', 'node_modules']);

// Recursively finds all SKILL.md files in the repo, skipping .git etc.
function findSkillFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isDirectory()) {
      results.push(...findSkillFiles(full));
    } else if (entry === 'SKILL.md') {
      results.push(full);
    }
  }
  return results;
}

function discoverFiles(dir, ext = null) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => !f.startsWith('.') && (ext === null || extname(f) === ext))
    .map(f => join(dir, f));
}
