import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync } from 'fs';
import { join, basename, extname } from 'path';
import { execa } from 'execa';
import { getSkillsDir, getScriptsDir } from '../config.js';

export async function syncGithub(source) {
  const cloneDir = join(getSkillsDir(), source.id);
  const { overrideCleared } = await resolveCheckout(source, cloneDir);

  const scripts = discoverFiles(join(cloneDir, '.claude', 'scripts'))
    .map(filePath => ({ scriptName: basename(filePath), filePath }));

  const scriptNames = new Set(scripts.map(s => s.scriptName));

  const commands = [];
  const skills = [];
  for (const filePath of discoverFiles(join(cloneDir, '.claude', 'commands'), '.md')) {
    const processed = rewriteScriptRefs(filePath, source.prefix, scriptNames, cloneDir);
    const content = readFileSync(processed, 'utf8');
    const skillName = extractSkillName(content);
    if (skillName) {
      skills.push({ skillName, filePath: processed });
    } else {
      commands.push({ commandName: basename(filePath), filePath: processed });
    }
  }

  // Also pick up .claude/skills/<name>/SKILL.md in the repo
  const skillsSourceDir = join(cloneDir, '.claude', 'skills');
  if (existsSync(skillsSourceDir)) {
    for (const entry of readdirSync(skillsSourceDir)) {
      const skillFile = join(skillsSourceDir, entry, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const content = readFileSync(skillFile, 'utf8');
      const skillName = extractSkillName(content) ?? entry;
      skills.push({ skillName, filePath: skillFile });
    }
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

function discoverFiles(dir, ext = null) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => !f.startsWith('.') && (ext === null || extname(f) === ext))
    .map(f => join(dir, f));
}
