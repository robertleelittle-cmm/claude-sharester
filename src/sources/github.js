import { existsSync, readdirSync } from 'fs';
import { join, basename, extname } from 'path';
import { execa } from 'execa';
import { getSkillsDir } from '../config.js';

export async function syncGithub(source) {
  const cloneDir = join(getSkillsDir(), source.id);

  if (!existsSync(cloneDir)) {
    await execa('git', ['clone', source.url, cloneDir], { stdio: 'pipe' });
  } else {
    await execa('git', ['-C', cloneDir, 'pull', '--ff-only'], { stdio: 'pipe' });
  }

  const commands = discoverFiles(join(cloneDir, '.claude', 'commands'), '.md')
    .map(filePath => ({ commandName: basename(filePath), filePath }));

  const scripts = discoverFiles(join(cloneDir, '.claude', 'scripts'))
    .map(filePath => ({ scriptName: basename(filePath), filePath }));

  return { commands, scripts, cloneDir };
}

function discoverFiles(dir, ext = null) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => !f.startsWith('.') && (ext === null || extname(f) === ext))
    .map(f => join(dir, f));
}
