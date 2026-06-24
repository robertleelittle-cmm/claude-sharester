# claude-sharester

Sync [Claude Code](https://claude.ai/code) commands from GitHub repos and Confluence pages. Add sources from your teammates, keep them up to date automatically.

## Install

```bash
npm install -g claude-sharester
```

Or run without installing:

```bash
npx claude-sharester <command>
```

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
| `add github <url> [--prefix name] [--id id]` | Register a GitHub repo source |
| `add confluence <pageId> --prefix name` | Register a Confluence page source |
| `remove <id>` | Remove a source and delete its symlinks |
| `list` | Show all configured sources |
| `sync [--source id]` | Pull all sources (or one) and refresh symlinks |
| `schedule [--interval 15m] [--method launchagent\|cron]` | Install auto-sync daemon |
| `unschedule` | Remove the auto-sync daemon |
| `status` | Show sync status and schedule |

## GitHub sources

Your teammate's repo should have Claude Code commands at `.claude/commands/*.md`. Supporting scripts at `.claude/scripts/*` are also synced automatically.

```
their-repo/
└── .claude/
    ├── commands/
    │   ├── standup.md
    │   └── review.md
    └── scripts/
        └── standup.js
```

After `claude-sharester sync`, these appear in your Claude Code as `/alice-standup` and `/alice-review`.

## Confluence sources

A Confluence page can define commands using code blocks. Each `code` macro block becomes one `.md` command file. The command name is taken from:
1. The macro's **title** parameter (set in the code block settings panel), or
2. The nearest preceding heading on the page

Auth is configured via environment variables (add these to your shell profile):

```bash
export CONFLUENCE_BASE_URL=https://yourcompany.atlassian.net/wiki
export CONFLUENCE_EMAIL=you@yourcompany.com
export CONFLUENCE_API_TOKEN=your-api-token   # https://id.atlassian.com/manage-profile/security/api-tokens
```

```bash
claude-sharester add confluence 12345678 --prefix team
claude-sharester sync
```

## Local development

If you're working on the source directly instead of installing from npm:

```bash
git clone https://github.com/robertleelittle-cmm/claude-sharester.git
cd claude-sharester
npm install
npm link        # makes `claude-sharester` available globally from this local copy
```

Changes to `src/` are reflected immediately — no build step required.

## Config

Sources are stored at `~/.claude/sharester.json`. Symlinks are created in `~/.claude/commands/` and `~/.claude/scripts/`. Synced repos are cloned to `~/.claude/skills/<id>/`.

## Migrating from a manual setup

If you previously set up a repo clone and LaunchAgent by hand, remove the old LaunchAgent and let claude-sharester take over:

```bash
launchctl unload ~/Library/LaunchAgents/com.claude.owen-skills-sync.plist
rm ~/Library/LaunchAgents/com.claude.owen-skills-sync.plist

claude-sharester add github https://github.com/your-teammate/tools.git --prefix owen
claude-sharester sync
claude-sharester schedule
```
