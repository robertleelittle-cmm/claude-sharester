# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Overview
`claude-sharester` is a Node.js CLI that syncs Claude Code commands from teammates' GitHub repos and Confluence pages into the local `~/.claude/` directory. It pulls each source, then creates namespaced symlinks so commands from different teammates never collide.

## Commands
- Run the CLI locally: `node bin/claude-sharester.js <command>` (the published bin is `claude-sharester`).
- Run tests: `npm test` (runs `node --test`). No test files exist yet; new tests should be `*.test.js` discoverable by the Node built-in test runner.
- There is no build step or linter configured. The package is plain ESM (`"type": "module"`), requires Node >= 18, and has no transpilation.

## Architecture
The CLI is a pipeline: **command parsing → per-source fetch → symlink reconciliation → config persistence.**
- `src/cli.js` — Commander command definitions (`add github|confluence`, `remove`, `list`, `sync`, `schedule`, `unschedule`, `status`). This is the only place user-facing commands and option parsing live. The bin entry (`bin/claude-sharester.js`) just imports it.
- `src/config.js` — Single source of truth for all filesystem locations. Config lives at `~/.claude/sharester.json` (`{ sources: [] }`); clones go to `~/.claude/skills/<id>/`; symlinks land in `~/.claude/commands/` and `~/.claude/scripts/`. Any new path must be added here and created via `ensureDirs()`.
- `src/sync.js` — Orchestrates a sync run: dispatches each source to its adapter by `source.type`, prunes stale symlinks, creates new ones, and stamps `lastSynced`. Errors per-source are caught and logged so one bad source does not abort the whole run.
- `src/sources/github.js` & `src/sources/confluence.js` — Source adapters. Each exports a `sync<Type>(source)` returning `{ commands, scripts }`, where each command/script is `{ commandName|scriptName, filePath }`. GitHub clones/pulls the repo and discovers `.claude/commands/*.md` and `.claude/scripts/*`. Confluence fetches page storage XML via REST and extracts `<ac:structured-macro ac:name="code">` blocks, writing each to a `.md` file. To add a new source type, add an adapter with this same return contract and wire it into `sync.js` and `cli.js`.
- `src/symlinks.js` — Reconciles symlinks idempotently. All links are named `<prefix>-<name>`; the prefix is how sources are namespaced and how `remove`/prune operations scope themselves. `_ensureSymlink` skips links already pointing at the right target, and `pruneStaleSymlinks` removes links whose targets no longer exist.
- `src/schedule.js` — Installs/removes the auto-sync daemon as either a macOS LaunchAgent (`~/Library/LaunchAgents/com.claude.sharester.plist`) or a cron entry (tagged with the `# claude-sharester` marker for safe identification/removal). `parseInterval` accepts `15m`/`1h`/`900s` forms.

## Key conventions
- **`id` vs `prefix` are distinct.** `id` drives the clone directory path (`~/.claude/skills/<id>/`) and is the unique key in `sharester.json`. `prefix` is the symlink namespace (`<prefix>-<name>.md`). They default to the same value but can differ via the `--id` flag. An agent must never conflate them.
- The `prefix` field is load-bearing: it is the only handle used to find and clean up a source's links on `remove` and on stale-link pruning. Confluence sources require an explicit `--prefix`; GitHub defaults it to the repo name.
- **Scripts land in `~/.claude/scripts/`, not `~/.claude/commands/`.** Command `.md` files → `~/.claude/commands/<prefix>-<name>.md`. Script files (`.js`, etc.) → `~/.claude/scripts/<prefix>-<name>`. A new adapter must return scripts as `{ scriptName, filePath }` (not `commandName`) so `symlinks.js` routes them correctly.
- **Stale pruning fires on every sync**, not only on `remove`. `pruneStaleSymlinks(prefix)` scans both `commands/` and `scripts/` for `<prefix>-*` symlinks whose targets no longer exist and removes them silently. This is intentional — it keeps the symlink dirs clean as a source evolves.
- Confluence command names come from the code macro's `title` parameter, falling back to the nearest preceding heading, then `command-N`.
- Confluence auth is via env vars `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`.

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
      "lastSynced": "2026-06-23T21:00:00.000Z"
    },
    {
      "id": "team-docs",
      "type": "confluence",
      "pageId": "12345678",
      "prefix": "team",
      "lastSynced": null
    }
  ]
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
