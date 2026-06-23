import { syncGithub } from './sources/github.js';
import { syncConfluence } from './sources/confluence.js';
import { syncSymlinks, pruneStaleSymlinks } from './symlinks.js';
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
      const { commands, scripts } = source.type === 'github'
        ? await syncGithub(source)
        : await syncConfluence(source);

      const stale = pruneStaleSymlinks(source.prefix);
      if (stale.length) console.log(chalk.dim(`  Removed stale: ${stale.join(', ')}`));

      const { created, skipped } = syncSymlinks(source.prefix, commands, scripts);
      if (created.length) console.log(chalk.green(`  Created: ${created.join(', ')}`));
      if (skipped.length) console.log(chalk.dim(`  Up to date: ${skipped.join(', ')}`));

      source.lastSynced = new Date().toISOString();
    } catch (err) {
      console.error(chalk.red(`  Error: ${err.message}`));
    }
  }

  saveConfig(config);
}
