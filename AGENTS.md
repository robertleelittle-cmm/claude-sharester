# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Overview
`claude-sharester` is a Node.js CLI that syncs Claude Code commands from teammates' GitHub repos and Confluence pages into the local `~/.claude/` directory. It pulls each source, then creates namespaced symlinks so commands from different teammates never collide.

## Commands
- Run the CLI locally: `node bin/claude-sharester.js <command>` (the published bin is `claude-sharester`).
- Run tests: `npm test` (runs `node --test`). No test files exist yet; new tests should be `*.test.js` discoverable by the Node built-in test runner.
- There is no build step or linter configured. The package is plain ESM (`"type": "module"`), requires Node >= 18, and has no transpilation.

Registered CLI commands: `init`, `add github`, `add confluence`, `remove`, `set-branch`, `clear-branch`, `list`, `sync`, `schedule`, `unschedule`, `status`. All positional arguments are optional — the CLI prompts interactively when a required value is omitted.

## Architecture
The CLI is a pipeline: **command parsing → per-source fetch → symlink reconciliation → config persistence.**
- `src/cli.js` — Commander command definitions. All positional arguments are optional; the CLI calls `src/prompt.js` helpers to prompt interactively when a value is missing. Registers a `postAction` hook that calls `checkForUpdates()` after every command. The bin entry (`bin/claude-sharester.js`) just imports this file.
- `src/prompt.js` — Thin readline wrappers: `ask(question, default)` for a single value, `choose(question, options)` for a numbered list, and `pickSource(config, verb)` which lists all configured sources and returns the chosen ID. Used by `cli.js`; not used in the sync path.
- `src/update-check.js` — Fetches `package.json` from the GitHub main branch once per 24 hours (timestamp stored as `lastVersionCheck` in `sharester.json`). If the remote version is newer, prints a notice and the correct update command (`git pull` for a local-linked clone, `npm install -g` otherwise). All network failures are silently swallowed — this must never interrupt normal usage.
- `src/config.js` — Single source of truth for all filesystem locations. Config lives at `~/.claude/sharester.json` (`{ sources: [], lastVersionCheck: <ms> }`); clones go to `~/.claude/skills/<id>/`; symlinks land in `~/.claude/commands/` and `~/.claude/scripts/`. Any new path must be added here and created via `ensureDirs()`.
- `src/sync.js` — Orchestrates a sync run: dispatches each source to its adapter by `source.type`, prunes stale symlinks, creates new ones, stamps `lastSynced`, and handles branch-override auto-clear. Errors per-source are caught and logged so one bad source does not abort the whole run.
- `src/sources/github.js` — GitHub adapter. Clones/pulls the repo, then calls `resolveCheckout(source, cloneDir)` to apply any branch override (switching to a fork remote and branch). `checkoutMain` tries `main` first, falls back to `master`. Rewrites relative `node .claude/scripts/<name>` refs in command files to absolute symlinked paths via `rewriteScriptRefs`. Returns `{ commands, scripts, overrideCleared }`. If `overrideCleared` is true, the branch was not found on the remote and `sync.js` will delete `source.override`.
- `src/sources/confluence.js` — Confluence adapter with two sync modes, chosen automatically. **Mode 1 (child pages):** if the configured page has child pages, each child page's storage-XML body is converted to markdown and written as a command file; the command name is derived from the child page title by stripping ` — Skill/Command Source` suffixes. **Mode 2 (code blocks):** if the page has no children, `<ac:structured-macro ac:name="code">` blocks are extracted and each becomes a command. After either mode, `pruneOutDir` deletes any files in the skills cache dir that are no longer in the current command set so `pruneStaleSymlinks` can clean up their symlinks. Auth uses `CONFLUENCE_*` env vars, falling back to `JIRA_BASE_URL/EMAIL/API_TOKEN` with `/wiki` appended. Tiny-link keys are resolved by following the `/wiki/x/<key>` redirect.
- `src/symlinks.js` — Reconciles symlinks idempotently. All links are named `<prefix>-<name>`; the prefix is how sources are namespaced and how `remove`/prune operations scope themselves. `_ensureSymlink` skips links already pointing at the right target, and `pruneStaleSymlinks` removes links whose targets no longer exist.
- `src/init.js` — Interactive readline wizard (invoked by the `init` command) that prompts for `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`, then writes/upserts them in `~/.zshrc` or `~/.bashrc`.
- `src/schedule.js` — Installs/removes the auto-sync daemon as either a macOS LaunchAgent (`~/Library/LaunchAgents/com.claude.sharester.plist`) or a cron entry (tagged with the `# claude-sharester` marker for safe identification/removal). `parseInterval` accepts `15m`/`1h`/`900s` forms.

## Key conventions
- **`id` vs `prefix` are distinct.** `id` drives the clone directory path (`~/.claude/skills/<id>/`) and is the unique key in `sharester.json`. `prefix` is the symlink namespace (`<prefix>-<name>.md`). They default to the same value but can differ via the `--id` flag. An agent must never conflate them.
- The `prefix` field is load-bearing: it is the only handle used to find and clean up a source's links on `remove` and on stale-link pruning. Confluence sources require an explicit `--prefix`; GitHub defaults it to the repo name.
- **Scripts land in `~/.claude/scripts/`, not `~/.claude/commands/`.** Command `.md` files → `~/.claude/commands/<prefix>-<name>.md`. Script files (`.js`, etc.) → `~/.claude/scripts/<prefix>-<name>`. A new adapter must return scripts as `{ scriptName, filePath }` (not `commandName`) so `symlinks.js` routes them correctly.
- **Stale pruning fires on every sync**, not only on `remove`. `pruneStaleSymlinks(prefix)` scans both `commands/` and `scripts/` for `<prefix>-*` symlinks whose targets no longer exist and removes them silently. This is intentional — it keeps the symlink dirs clean as a source evolves.
- **Confluence two-mode detection:** child pages take priority over code blocks. If the page has children, Mode 1 runs (child pages as commands). Only if there are no children does Mode 2 run (code blocks on the parent). This means a hub/index page that happens to have code blocks in its documentation will still sync from its children, not its code blocks.
- Confluence command names: in Mode 1, derived from child page titles (strip ` — Skill/Command Source`, strip leading `/`, slugify). In Mode 2, from the code macro's `title` parameter, falling back to the nearest preceding heading, then `command-N`.
- **Confluence auth falls back to `JIRA_*` vars.** The adapter checks `CONFLUENCE_BASE_URL/EMAIL/API_TOKEN` first, then falls back to `JIRA_BASE_URL` (with `/wiki` appended), `JIRA_EMAIL`, and `JIRA_API_TOKEN`. `claude-sharester init` only writes `JIRA_*` vars — that is sufficient for both Jira and Confluence sources.
- **Tiny-link keys are resolved automatically.** A Confluence `pageId` that is not purely numeric (e.g. `xYC06g`) is treated as a tiny-link key and resolved to a numeric ID by fetching `${baseUrl}/x/${key}` and extracting the ID from the redirect URL.
- **Branch overrides** are stored as `source.override = { branch, remote? }` in `sharester.json`. On each GitHub sync, `resolveCheckout` checks whether the override branch still exists via `git ls-remote --heads`. If it is gone, `syncGithub` returns `overrideCleared: true` and `sync.js` deletes the override from config.

## Config schema

`~/.claude/sharester.json`:
```json
{
  "sources": [
    {
      "id": "owen",
      "type": "github",
      "url": "https://github.com/owner/repo.git",
      "prefix": "owen",
      "lastSynced": "2026-06-23T21:00:00.000Z",
      "override": {
        "branch": "my-pr-branch",
        "remote": "https://github.com/fork/repo.git"
      }
    },
    {
      "id": "team-docs",
      "type": "confluence",
      "pageId": "12345678",
      "prefix": "team",
      "lastSynced": null
    }
  ],
  "lastVersionCheck": 1750000000000
}
```

## Local development

```bash
# Run directly without installing
node bin/claude-sharester.js <command>

# Install globally from local source for end-to-end testing
npm link
claude-sharester <command>
```

There is no build step, no transpilation, and no linter. The package is plain ESM (`"type": "module"`) targeting Node >= 18. `node bin/claude-sharester.js` is the canonical local invocation.
