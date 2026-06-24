import { syncGithub } from './sources/github.js';
import { syncConfluence } from './sources/confluence.js';
import { syncSymlinks, pruneStaleSymlinks, syncSkillDirs, pruneObsoleteSkillDirs, demoteCommandLinks } from './symlinks.js';
import { loadConfig, saveConfig } from './config.js';
import chalk from 'chalk';

export async function syncAll(opts = {}) {
  const config = loadConfig();
  const sources = opts.sourceId
    ? config.sources.filter(s => s.id === opts.sourceId)
    : config.sources;

  if (sources.length === 0) {
    console.log(chalk.yellow(opts.sourceId ? `No source found with id "${opts.sourceId}".` : 'No sources configured. Run `claude-sharester add` to get started.'));
    return;
  }

  for (const source of sources) {
    console.log(chalk.cyan(`\nSyncing ${source.id} (${source.type}: ${source.url ?? source.pageId})...`));
    try {
      const { commands, scripts, skills = [], overrideCleared } = source.type === 'github'
        ? await syncGithub(source)
        : await syncConfluence(source);

      if (overrideCleared) {
        console.log(chalk.yellow(`  Branch "${source.override.branch}" no longer exists on remote — override cleared, reverted to main.`));
        delete source.override;
      }

      const stale = pruneStaleSymlinks(source.prefix);
      if (stale.length) console.log(chalk.dim(`  Removed stale: ${stale.join(', ')}`));

      // Move any existing command symlinks for skill files to the skills dir
      demoteCommandLinks(source.prefix, skills.map(s => s.skillName));

      const { created, skipped } = syncSymlinks(source.prefix, commands, scripts);
      if (created.length) console.log(chalk.green(`  Created: ${created.join(', ')}`));
      if (skipped.length) console.log(chalk.dim(`  Up to date: ${skipped.join(', ')}`));

      const { created: skillCreated, skipped: skillSkipped } = syncSkillDirs(source.prefix, skills);
      if (skillCreated.length) console.log(chalk.green(`  Skills created: ${skillCreated.join(', ')}`));
      if (skillSkipped.length) console.log(chalk.dim(`  Skills up to date: ${skillSkipped.join(', ')}`));

      // Prune skill dirs that are no longer in this source's skill set
      const currentDirNames = skills.map(s => `${source.prefix}-${s.skillName}`);
      const obsolete = pruneObsoleteSkillDirs(source.prefix, currentDirNames);
      if (obsolete.length) console.log(chalk.dim(`  Removed stale skills: ${obsolete.join(', ')}`));

      source.lastSynced = new Date().toISOString();
    } catch (err) {
      console.error(chalk.red(`  Error: ${err.message}`));
    }
  }

  saveConfig(config);
}
