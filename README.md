# claude-sharester

Sync [Claude Code](https://claude.ai/code) commands from GitHub repos and Confluence pages. Add sources from your teammates, keep them up to date automatically.

## Requirements

- Node.js >= 18

## Install

```bash
npm install -g claude-sharester
```

> **Note:** `npx claude-sharester` will work once this package is published to npm. Until then, use the [local development](#local-development) setup below.

## Quickstart

```bash
# Add a GitHub repo that contains .claude/commands/*.md files
claude-sharester add github https://github.com/your-teammate/tools.git --prefix alice

# Pull commands and create symlinks in ~/.claude/commands/
claude-sharester sync

# Auto-sync every 15 minutes via macOS LaunchAgent
claude-sharester schedule --interval 15m --method launchagent
```

Commands are symlinked as `<prefix>-<commandname>.md` so multiple teammates' commands never conflict.

## Commands

| Command | Description |
|---|---|
| `init` | Interactively configure Atlassian credentials in your shell profile |
| `add` | Interactive wizard — prompts for type, URL/pageId, prefix, and ID |
| `add github [url] [--prefix name] [--id id]` | Register a GitHub repo source (prompts if URL omitted) |
| `add confluence [pageId] [--prefix name] [--id id]` | Register a Confluence page source (prompts if pageId or prefix omitted) |
| `remove [id]` | Remove a source and delete its symlinks (prompts to pick if ID omitted) |
| `set-branch [id] [branch] [--remote <url>]` | Sync from a fork branch instead of main (prompts if args omitted) |
| `clear-branch [id]` | Remove branch override, revert to main on next sync (prompts if ID omitted) |
| `list` | Show all configured sources |
| `sync [--source id]` | Pull all sources (or one) and refresh symlinks |
| `schedule [--interval 15m] [--method launchagent\|cron]` | Install auto-sync daemon |
| `unschedule` | Remove the auto-sync daemon |
| `status` | Show sync status and schedule |

All arguments are optional — omit any required value and the CLI will prompt you interactively.

## Branch overrides

Test a teammate's PR branch before it merges — point any GitHub source at a fork branch and sync from it instead of main.

```bash
# Your fork's PR branch
claude-sharester set-branch owen standup-temp-dir-and-browser-open \
  --remote https://github.com/your-fork/tools.git
claude-sharester sync
```

The override is stored in config and applied on every sync. When the PR is merged and the branch is deleted, the next sync detects the missing branch, prints a notice, and automatically reverts to main — no manual cleanup needed:

```
⚠  Branch "standup-temp-dir-and-browser-open" no longer exists on remote — override cleared, reverted to main.
```

To clear manually before the branch is deleted:

```bash
claude-sharester clear-branch owen
claude-sharester sync
```

Active overrides are shown in `claude-sharester list` and `claude-sharester status`.

## GitHub sources

Your teammate's repo should have Claude Code commands at `.claude/commands/*.md`. Supporting scripts at `.claude/scripts/*` are also synced automatically. Skills (`.claude/skills/<name>/SKILL.md` or any command file with a `name:` YAML frontmatter field) are installed to `~/.claude/skills/` so they appear in the Claude Code skills list, not just the slash-command list.

```
their-repo/
└── .claude/
    ├── commands/
    │   ├── standup.md       ← installed as /alice-standup command
    │   └── review.md        ← installed as /alice-review command
    ├── skills/
    │   └── platform-quality/
    │       └── SKILL.md     ← installed as /alice-platform-quality skill
    └── scripts/
        └── standup.js
```

After `claude-sharester sync`, commands appear in your Claude Code as `/alice-standup` and `/alice-review`, and skills appear in the skills list as `/alice-platform-quality`.

## Atlassian credentials

Confluence sources and any synced scripts that call the Jira or Confluence APIs require credentials in your shell environment. Run the interactive setup wizard to configure them:

```bash
claude-sharester init
```

This prompts for the three values below and writes them to `~/.zshrc` (or `~/.bashrc`), updating existing entries in-place rather than duplicating them.

| Variable | Example value |
|---|---|
| `JIRA_BASE_URL` | `https://yourcompany.atlassian.net` |
| `JIRA_EMAIL` | `you@yourcompany.com` |
| `JIRA_API_TOKEN` | _(see below)_ |

**Getting an API token:** Go to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens), click **Create API token**, give it a label, and copy the value. Treat it like a password — do not commit it to source control.

After running `claude-sharester init`, open a new terminal or run `source ~/.zshrc` for the exports to take effect.

> **Note:** These same `JIRA_*` variables are also used for Confluence syncs — no separate `CONFLUENCE_*` vars needed. The Confluence REST API lives at `JIRA_BASE_URL/wiki`, so one set of credentials covers both.

## Confluence sources

claude-sharester supports two Confluence page layouts automatically:

**Hub/index page** — a parent page whose child subpages each contain one command. Each child page's body becomes a `.md` command file; the command name is derived from the child page title (stripping any ` — Skill Source` / ` — Command Source` suffix). Point the source at the parent page and all children are synced:

```bash
claude-sharester add confluence 3937697989 --prefix rob
claude-sharester sync
# → rob-argo-deploy.md, rob-pr-screenshots.md, rob-release.md, …
```

**Single page with code blocks** — a page that has no children but contains Confluence `Code` macro blocks. Each block becomes one command. The command name is taken from:
1. The macro's **title** parameter (set in the code block settings panel), or
2. The nearest preceding heading on the page

The page ID can be a numeric ID from the URL, or a Confluence tiny-link key (the short alphanumeric code after `/wiki/x/` in a short URL — e.g. `xYC06g`). claude-sharester resolves tiny links automatically.

```bash
claude-sharester add confluence xYC06g --prefix wiki
claude-sharester sync
```

When a Confluence source's command set changes (children added or removed), stale command files are cleaned up automatically on the next sync.

## Update notifications

After each command, claude-sharester checks once per day whether a newer version is available on GitHub. If one is found, it prints a notice and the command to update:

```
  Update available: 0.1.0 → 0.1.1
  Run: git -C /path/to/claude-sharester pull
```

The check is non-blocking and silently skipped when offline or if the network times out. The last-checked timestamp is stored in `~/.claude/sharester.json` as `lastVersionCheck`.

## Local development

If you're working on the source directly instead of installing from npm:

```bash
git clone https://github.com/robertleelittle-cmm/claude-sharester.git
cd claude-sharester
npm install
npm link        # makes `claude-sharester` available globally from this local copy
```

Changes to `src/` are reflected immediately — no build step required.

To undo the global link:

```bash
npm unlink -g claude-sharester
```

## Scheduling and logs

When auto-sync is running, all output is written to `~/.claude/skills/sharester.log`. Check it if a sync seems to have failed silently:

```bash
tail -f ~/.claude/skills/sharester.log
```

To confirm the LaunchAgent is loaded:

```bash
launchctl list | grep sharester
```

## Skills vs commands

Claude Code distinguishes between **skills** (`~/.claude/skills/<name>/SKILL.md`) and **commands** (`~/.claude/commands/<name>.md`). Skills appear in the skills list; commands appear only as slash commands.

claude-sharester detects skills automatically:
- Any synced file with a `name:` field in its YAML frontmatter is treated as a skill
- GitHub repos with a `.claude/skills/<name>/SKILL.md` directory layout are also picked up

Both GitHub and Confluence sources are handled. The installed skill directories are namespaced with the source prefix: `~/.claude/skills/<prefix>-<name>/SKILL.md`.

## Config

Sources are stored at `~/.claude/sharester.json`. Command symlinks are created in `~/.claude/commands/` and `~/.claude/scripts/`. Skill directories are created in `~/.claude/skills/<prefix>-<name>/`. Synced repos are cloned to `~/.claude/skills/<id>/`.

> **Note:** `claude-sharester remove <id>` deletes the source's symlinks but leaves the cloned repo under `~/.claude/skills/<id>/` on disk. Remove that directory manually if you want to free the space.

## Migrating from a manual setup

If you previously set up a repo clone and LaunchAgent by hand, remove the old LaunchAgent and let claude-sharester take over:

```bash
launchctl unload ~/Library/LaunchAgents/com.claude.owen-skills-sync.plist
rm ~/Library/LaunchAgents/com.claude.owen-skills-sync.plist

claude-sharester add github https://github.com/your-teammate/tools.git --prefix owen
claude-sharester sync
claude-sharester schedule
```
