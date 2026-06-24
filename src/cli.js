import { program } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig, ensureDirs, getConfigPath } from './config.js';
import { syncAll } from './sync.js';
import { removeSourceSymlinks } from './symlinks.js';
import { scheduleSync, unschedule, getScheduleStatus } from './schedule.js';
import { runInit } from './init.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

program
  .name('claude-sharester')
  .description('Sync Claude Code commands from GitHub repos and Confluence pages')
  .version(pkg.version);

// ── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Set up Jira credentials in your shell init file')
  .action(async () => {
    await runInit();
  });

// ── add ──────────────────────────────────────────────────────────────────────

const add = program.command('add').description('Add a source');

add
  .command('github <url>')
  .description('Add a GitHub repo source')
  .option('--prefix <name>', 'Namespace prefix for commands (defaults to repo name)')
  .option('--id <id>', 'Unique source ID (defaults to prefix)')
  .action(async (url, opts) => {
    ensureDirs();
    const config = loadConfig();

    const repoName = url.replace(/\.git$/, '').split('/').pop();
    const prefix = opts.prefix ?? repoName;
    const id = opts.id ?? prefix;

    if (config.sources.find(s => s.id === id)) {
      console.error(chalk.red(`Source "${id}" already exists. Use a different --id or remove it first.`));
      process.exit(1);
    }

    config.sources.push({ id, type: 'github', url, prefix, lastSynced: null });
    saveConfig(config);
    console.log(chalk.green(`Added GitHub source "${id}" with prefix "${prefix}".`));
    console.log(chalk.dim('Run `claude-sharester sync` to pull commands.'));
  });

add
  .command('confluence <pageId>')
  .description('Add a Confluence page source (use page ID or full URL)')
  .option('--prefix <name>', 'Namespace prefix for commands (required)')
  .option('--id <id>', 'Unique source ID (defaults to prefix)')
  .action(async (rawPageId, opts) => {
    ensureDirs();

    // Accept full Confluence URL or bare page ID
    const pageId = rawPageId.includes('/') ? rawPageId.split('/').pop() : rawPageId;
    const prefix = opts.prefix;

    if (!prefix) {
      console.error(chalk.red('--prefix is required for Confluence sources (e.g. --prefix team)'));
      process.exit(1);
    }

    const id = opts.id ?? prefix;
    const config = loadConfig();

    if (config.sources.find(s => s.id === id)) {
      console.error(chalk.red(`Source "${id}" already exists. Use a different --id or remove it first.`));
      process.exit(1);
    }

    config.sources.push({ id, type: 'confluence', pageId, prefix, lastSynced: null });
    saveConfig(config);
    console.log(chalk.green(`Added Confluence source "${id}" (page ${pageId}) with prefix "${prefix}".`));
    console.log(chalk.dim('Run `claude-sharester sync` to pull commands.'));
  });

// ── remove ────────────────────────────────────────────────────────────────────

program
  .command('remove <id>')
  .description('Remove a source and delete its symlinks')
  .action(async (id) => {
    const config = loadConfig();
    const idx = config.sources.findIndex(s => s.id === id);
    if (idx === -1) {
      console.error(chalk.red(`No source found with id "${id}".`));
      process.exit(1);
    }
    const { prefix } = config.sources[idx];
    const removed = removeSourceSymlinks(prefix);
    config.sources.splice(idx, 1);
    saveConfig(config);
    console.log(chalk.green(`Removed source "${id}".`));
    if (removed.length) console.log(chalk.dim(`Deleted symlinks: ${removed.join(', ')}`));
  });

// ── set-branch ───────────────────────────────────────────────────────────────

program
  .command('set-branch <id> <branch>')
  .description('Pin a source to a specific branch (e.g. a PR branch on a fork)')
  .option('--remote <url>', 'Fork URL to fetch from (defaults to the source URL)')
  .action((id, branch, opts) => {
    const config = loadConfig();
    const source = config.sources.find(s => s.id === id);
    if (!source) {
      console.error(chalk.red(`No source found with id "${id}".`));
      process.exit(1);
    }
    if (source.type !== 'github') {
      console.error(chalk.red('Branch overrides are only supported for GitHub sources.'));
      process.exit(1);
    }
    source.override = { branch, ...(opts.remote ? { remote: opts.remote } : {}) };
    saveConfig(config);
    const remoteNote = opts.remote ? ` from ${opts.remote}` : '';
    console.log(chalk.green(`Branch override set for "${id}": ${branch}${remoteNote}.`));
    console.log(chalk.dim('Run `claude-sharester sync` to apply. Override auto-clears when the branch is deleted.'));
  });

// ── clear-branch ──────────────────────────────────────────────────────────────

program
  .command('clear-branch <id>')
  .description('Remove a branch override, reverting to main on next sync')
  .action((id) => {
    const config = loadConfig();
    const source = config.sources.find(s => s.id === id);
    if (!source) {
      console.error(chalk.red(`No source found with id "${id}".`));
      process.exit(1);
    }
    if (!source.override) {
      console.log(chalk.yellow(`No branch override set for "${id}".`));
      return;
    }
    delete source.override;
    saveConfig(config);
    console.log(chalk.green(`Branch override cleared for "${id}". Run \`claude-sharester sync\` to revert to main.`));
  });

// ── list ──────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List all configured sources')
  .action(() => {
    const config = loadConfig();
    if (!config.sources.length) {
      console.log(chalk.yellow('No sources configured. Run `claude-sharester add` to get started.'));
      return;
    }
    console.log(chalk.bold('\nConfigured sources:'));
    for (const s of config.sources) {
      const synced = s.lastSynced ? new Date(s.lastSynced).toLocaleString() : 'never';
      const detail = s.type === 'github' ? s.url : `page ${s.pageId}`;
      console.log(`  ${chalk.cyan(s.id)} (${s.type}) — prefix: ${chalk.bold(s.prefix)} — ${detail}`);
      console.log(chalk.dim(`    last synced: ${synced}`));
      if (s.override) {
        const remoteNote = s.override.remote ? ` from ${s.override.remote}` : '';
        console.log(chalk.yellow(`    branch override: ${s.override.branch}${remoteNote}`));
      }
    }
    console.log();
  });

// ── sync ──────────────────────────────────────────────────────────────────────

program
  .command('sync')
  .description('Pull all sources and refresh symlinks')
  .option('--source <id>', 'Sync only a specific source')
  .action(async (opts) => {
    ensureDirs();
    await syncAll({ sourceId: opts.source });
    console.log(chalk.green('\nSync complete.'));
  });

// ── schedule ──────────────────────────────────────────────────────────────────

program
  .command('schedule')
  .description('Install auto-sync daemon')
  .option('--interval <time>', 'Sync interval (e.g. 15m, 1h)', '15m')
  .option('--method <method>', 'Scheduling method: launchagent or cron', 'launchagent')
  .action(async (opts) => {
    if (!['launchagent', 'cron'].includes(opts.method)) {
      console.error(chalk.red('--method must be "launchagent" or "cron"'));
      process.exit(1);
    }
    await scheduleSync({ interval: opts.interval, method: opts.method });
    console.log(chalk.green(`Auto-sync scheduled every ${opts.interval} via ${opts.method}.`));
  });

// ── unschedule ────────────────────────────────────────────────────────────────

program
  .command('unschedule')
  .description('Remove the auto-sync daemon')
  .action(async () => {
    const removed = await unschedule();
    if (removed) {
      console.log(chalk.green('Auto-sync removed.'));
    } else {
      console.log(chalk.yellow('No auto-sync was configured.'));
    }
  });

// ── status ────────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show sync status and schedule')
  .action(async () => {
    const config = loadConfig();
    const { hasLaunchAgent, hasCron, plistPath } = await getScheduleStatus();

    console.log(chalk.bold('\nSources:'));
    if (!config.sources.length) {
      console.log('  (none)');
    } else {
      for (const s of config.sources) {
        const synced = s.lastSynced ? new Date(s.lastSynced).toLocaleString() : chalk.yellow('never');
        console.log(`  ${chalk.cyan(s.id)} — last synced: ${synced}`);
        if (s.override) {
          const remoteNote = s.override.remote ? ` from ${s.override.remote}` : '';
          console.log(chalk.yellow(`    override: ${s.override.branch}${remoteNote}`));
        }
      }
    }

    console.log(chalk.bold('\nSchedule:'));
    if (hasLaunchAgent) {
      console.log(`  ${chalk.green('LaunchAgent active')} — ${plistPath}`);
    } else if (hasCron) {
      console.log(`  ${chalk.green('cron active')}`);
    } else {
      console.log(`  ${chalk.dim('not scheduled')} (run \`claude-sharester schedule\` to enable)`);
    }

    console.log(chalk.dim(`\nConfig: ${getConfigPath()}\n`));
  });

program.parse();
