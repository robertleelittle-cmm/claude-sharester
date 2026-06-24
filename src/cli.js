import { program } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig, ensureDirs, getConfigPath } from './config.js';
import { syncAll } from './sync.js';
import { removeSourceSymlinks, removeSourceSkillDirs } from './symlinks.js';
import { scheduleSync, unschedule, getScheduleStatus } from './schedule.js';
import { runInit } from './init.js';
import { ask, choose, pickSource } from './prompt.js';
import { checkForUpdates } from './update-check.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

program
  .name('claude-sharester')
  .description('Sync Claude Code commands from GitHub repos and Confluence pages')
  .version(pkg.version)
  .addHelpText('after', `
Examples:
  $ claude-sharester init
  $ claude-sharester add github https://github.com/teammate/tools.git --prefix alice
  $ claude-sharester add confluence 12345678 --prefix team
  $ claude-sharester sync
  $ claude-sharester schedule --interval 15m
  $ claude-sharester set-branch owen my-pr-branch --remote https://github.com/fork/tools.git

Credentials:
  Confluence and Jira sources require JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN
  in your environment. Run \`claude-sharester init\` to set them up interactively.

Config & data:
  Config:   ~/.claude/sharester.json
  Commands: ~/.claude/commands/<prefix>-<name>.md
  Scripts:  ~/.claude/scripts/<prefix>-<name>
  Repos:    ~/.claude/skills/<id>/
  Logs:     ~/.claude/skills/sharester.log`);

// ── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Interactively configure Atlassian (Jira/Confluence) credentials in your shell profile')
  .addHelpText('after', `
Prompts for JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN and writes them to
~/.zshrc (or ~/.bashrc). Updates existing entries in place — no duplicates.

Get an API token at: https://id.atlassian.com/manage-profile/security/api-tokens`)
  .action(async () => {
    await runInit();
  });

// ── add ──────────────────────────────────────────────────────────────────────

const add = program
  .command('add')
  .description('Register a new source (GitHub repo or Confluence page)')
  .addHelpText('after', `
Subcommands:
  github <url>         Add a GitHub repo that contains .claude/commands/*.md files
  confluence <pageId>  Add a Confluence page whose code blocks become commands

Run \`claude-sharester add github --help\` or \`claude-sharester add confluence --help\`
for subcommand-specific options.`)
  .action(async () => {
    // Interactive wizard when no subcommand is given
    ensureDirs();
    const type = await choose('What type of source?', ['github', 'confluence']);

    if (type === 'github') {
      const url = await ask('GitHub repo URL (e.g. https://github.com/teammate/tools.git)');
      if (!url) { console.error(chalk.red('URL is required.')); process.exit(1); }
      const defaultPrefix = url.replace(/\.git$/, '').split('/').pop();
      const prefix = await ask('Prefix for commands', defaultPrefix);
      const id = await ask('Source ID', prefix);
      const config = loadConfig();
      if (config.sources.find(s => s.id === id)) {
        console.error(chalk.red(`Source "${id}" already exists.`)); process.exit(1);
      }
      config.sources.push({ id, type: 'github', url, prefix, lastSynced: null });
      saveConfig(config);
      console.log(chalk.green(`\nAdded GitHub source "${id}" with prefix "${prefix}".`));
    } else {
      const rawPageId = await ask('Confluence page ID or tiny-link key (e.g. 12345678 or xYC06g)');
      if (!rawPageId) { console.error(chalk.red('Page ID is required.')); process.exit(1); }
      const pageId = rawPageId.includes('/') ? rawPageId.split('/').pop() : rawPageId;
      const prefix = await ask('Prefix for commands (e.g. team)');
      if (!prefix) { console.error(chalk.red('Prefix is required.')); process.exit(1); }
      const id = await ask('Source ID', prefix);
      const config = loadConfig();
      if (config.sources.find(s => s.id === id)) {
        console.error(chalk.red(`Source "${id}" already exists.`)); process.exit(1);
      }
      config.sources.push({ id, type: 'confluence', pageId, prefix, lastSynced: null });
      saveConfig(config);
      console.log(chalk.green(`\nAdded Confluence source "${id}" (page ${pageId}) with prefix "${prefix}".`));
    }
    console.log(chalk.dim('Run `claude-sharester sync` to pull commands.'));
  });

add
  .command('github [url]')
  .description('Add a GitHub repo that contains .claude/commands/*.md files')
  .option('--prefix <name>', 'Namespace prefix for synced commands (defaults to repo name)')
  .option('--id <id>',       'Unique source ID used in other commands (defaults to prefix)')
  .addHelpText('after', `
The repo should contain commands at .claude/commands/*.md.
Supporting scripts at .claude/scripts/* are also synced automatically.

After sync, commands appear in Claude Code as /<prefix>-<commandname>.

Examples:
  $ claude-sharester add github https://github.com/alice/tools.git
  $ claude-sharester add github https://github.com/alice/tools.git --prefix alice --id alice`)
  .action(async (url, opts) => {
    ensureDirs();
    if (!url) {
      url = await ask('GitHub repo URL (e.g. https://github.com/teammate/tools.git)');
      if (!url) { console.error(chalk.red('URL is required.')); process.exit(1); }
    }
    const config = loadConfig();
    const repoName = url.replace(/\.git$/, '').split('/').pop();
    const prefix = opts.prefix ?? await ask('Prefix for commands', repoName);
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
  .command('confluence [pageId]')
  .description('Add a Confluence page — each code block on the page becomes a command')
  .option('--prefix <name>', 'Namespace prefix for synced commands (required)')
  .option('--id <id>',       'Unique source ID used in other commands (defaults to prefix)')
  .addHelpText('after', `
The page ID is the numeric ID from the page URL, or a Confluence tiny-link key
(the short alphanumeric code after /wiki/x/ in a short URL).

Each "Code" macro block on the Confluence page becomes one .md command file.
The command name comes from the macro's title, or the nearest preceding heading.

Requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in your environment.
Run \`claude-sharester init\` to configure them.

Examples:
  $ claude-sharester add confluence 12345678 --prefix team
  $ claude-sharester add confluence xYC06g --prefix wiki --id wiki`)
  .action(async (rawPageId, opts) => {
    ensureDirs();
    if (!rawPageId) {
      rawPageId = await ask('Confluence page ID or tiny-link key');
      if (!rawPageId) { console.error(chalk.red('Page ID is required.')); process.exit(1); }
    }
    const pageId = rawPageId.includes('/') ? rawPageId.split('/').pop() : rawPageId;
    const prefix = opts.prefix ?? await ask('Prefix for commands (e.g. team)');
    if (!prefix) { console.error(chalk.red('--prefix is required.')); process.exit(1); }
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
  .command('remove [id]')
  .description('Remove a source and delete all its symlinked commands and scripts')
  .addHelpText('after', `
Deletes symlinks from ~/.claude/commands/ and ~/.claude/scripts/ but leaves the
cloned repo under ~/.claude/skills/<id>/ on disk. Remove that directory manually
if you want to free the space.

Example:
  $ claude-sharester remove alice`)
  .action(async (id) => {
    const config = loadConfig();
    if (!id) {
      id = await pickSource(config, 'remove');
      if (!id) { console.log(chalk.yellow('No sources configured.')); return; }
    }
    const idx = config.sources.findIndex(s => s.id === id);
    if (idx === -1) {
      console.error(chalk.red(`No source found with id "${id}".`));
      process.exit(1);
    }
    const { prefix } = config.sources[idx];
    const removed = removeSourceSymlinks(prefix);
    const removedSkills = removeSourceSkillDirs(prefix);
    config.sources.splice(idx, 1);
    saveConfig(config);
    console.log(chalk.green(`Removed source "${id}".`));
    if (removed.length) console.log(chalk.dim(`Deleted symlinks: ${removed.join(', ')}`));
    if (removedSkills.length) console.log(chalk.dim(`Deleted skill dirs: ${removedSkills.join(', ')}`));
  });

// ── set-branch ───────────────────────────────────────────────────────────────

program
  .command('set-branch [id] [branch]')
  .description('Pin a GitHub source to a specific branch or fork, e.g. to test a PR')
  .option('--remote <url>', 'Fork remote URL to fetch from (defaults to the source\'s registered URL)')
  .addHelpText('after', `
The override is stored in config and applied on every sync. When the branch is
deleted (e.g. after a PR merges), the next sync detects it, prints a notice, and
automatically reverts to main — no manual cleanup needed.

Examples:
  # Pin to a branch on the same remote
  $ claude-sharester set-branch owen my-feature-branch

  # Pin to a branch on a fork
  $ claude-sharester set-branch owen my-feature-branch --remote https://github.com/fork/tools.git`)
  .action(async (id, branch, opts) => {
    const config = loadConfig();
    if (!id) {
      id = await pickSource(config, 'set a branch override on');
      if (!id) { console.log(chalk.yellow('No sources configured.')); return; }
    }
    const source = config.sources.find(s => s.id === id);
    if (!source) {
      console.error(chalk.red(`No source found with id "${id}".`));
      process.exit(1);
    }
    if (source.type !== 'github') {
      console.error(chalk.red('Branch overrides are only supported for GitHub sources.'));
      process.exit(1);
    }
    if (!branch) {
      branch = await ask('Branch name');
      if (!branch) { console.error(chalk.red('Branch is required.')); process.exit(1); }
    }
    source.override = { branch, ...(opts.remote ? { remote: opts.remote } : {}) };
    saveConfig(config);
    const remoteNote = opts.remote ? ` from ${opts.remote}` : '';
    console.log(chalk.green(`Branch override set for "${id}": ${branch}${remoteNote}.`));
    console.log(chalk.dim('Run `claude-sharester sync` to apply. Override auto-clears when the branch is deleted.'));
  });

// ── clear-branch ──────────────────────────────────────────────────────────────

program
  .command('clear-branch [id]')
  .description('Remove a branch override, reverting the source to main on next sync')
  .action(async (id) => {
    const config = loadConfig();
    if (!id) {
      const overridden = config.sources.filter(s => s.override);
      if (!overridden.length) { console.log(chalk.yellow('No branch overrides set.')); return; }
      if (overridden.length === 1) {
        id = overridden[0].id;
      } else {
        id = await pickSource({ sources: overridden }, 'clear the override on');
      }
    }
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
  .description('List all configured sources with their sync status')
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
  .description('Pull all sources (or one) and refresh symlinks in ~/.claude/commands/')
  .option('--source <id>', 'Sync only a specific source by its ID')
  .addHelpText('after', `
Examples:
  $ claude-sharester sync               # sync all sources
  $ claude-sharester sync --source owen # sync only the "owen" source`)
  .action(async (opts) => {
    ensureDirs();
    await syncAll({ sourceId: opts.source });
    console.log(chalk.green('\nSync complete.'));
  });

// ── schedule ──────────────────────────────────────────────────────────────────

program
  .command('schedule')
  .description('Install a background daemon that auto-syncs on a schedule')
  .option('--interval <time>', 'How often to sync (e.g. 15m, 1h, 30m)', '15m')
  .option('--method <method>', 'Scheduling backend: launchagent (macOS) or cron', 'launchagent')
  .addHelpText('after', `
Logs are written to ~/.claude/skills/sharester.log.

To confirm the LaunchAgent is loaded:
  $ launchctl list | grep sharester

Examples:
  $ claude-sharester schedule                       # every 15 min via LaunchAgent
  $ claude-sharester schedule --interval 1h
  $ claude-sharester schedule --method cron --interval 30m`)
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
  .description('Remove the auto-sync daemon (LaunchAgent or cron entry)')
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
  .description('Show each source\'s last sync time, any branch overrides, and schedule info')
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

program.hook('postAction', async () => { await checkForUpdates(); });

program.parse();
