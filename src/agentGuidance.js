import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { choose } from './prompt.js';
import { loadConfig, saveConfig } from './config.js';

export const SKILL_NAME = 'claude-sharester-branch-workflow';

const SKILL_PATH = join(homedir(), '.claude', 'skills', SKILL_NAME, 'SKILL.md');
const CLAUDE_MD_PATH = join(homedir(), '.claude', 'CLAUDE.md');
const START_MARKER = '<!-- claude-sharester:agent-guidance:start -->';
const END_MARKER = '<!-- claude-sharester:agent-guidance:end -->';
const NUDGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

const GUIDANCE_BODY = `Skills and commands installed by claude-sharester are synced *output* — files under
\`~/.claude/commands/\`, \`~/.claude/scripts/\`, and \`~/.claude/skills/<prefix>-<name>/\` are
overwritten on every sync. The real source is the git clone at \`~/.claude/skills/<id>/\`.

When asked to modify a synced skill or command (e.g. "fix the owen-standup skill"):

1. Locate the source: run \`claude-sharester list\` to map the \`<prefix>-<name>\` you were
   given back to its \`id\` and \`url\` (or read \`~/.claude/sharester.json\`).
2. Find the real file inside the clone at \`~/.claude/skills/<id>/\` — check
   \`.claude/commands/\`, \`.claude/skills/\`, and any nested \`SKILL.md\` (plugin repos can
   nest it, e.g. \`src/plugins/<plugin>/skills/<name>/SKILL.md\`).
3. Edit the file directly, in place, on whatever ref is currently checked out. Do
   **not** create a branch, fork, or run \`set-branch\` yet — let the user iterate
   freely first. Just avoid running \`sync\` for that source while an edit is
   uncommitted, since a sync can pull main forward and clash with it.
4. As edits accumulate, offer — don't force — to formalize into a branch, e.g. "Want
   me to turn this into a branch so you can test it live and share it with
   teammates?" Only branch, fork, and set an override once the user says yes.
5. Formalizing, once confirmed:
   a. Fork the source repo on GitHub if the user doesn't already have one.
   b. \`git -C ~/.claude/skills/<id> checkout -b <branch-name>\`, commit the edits made
      so far.
   c. Add the fork as a remote (skip if already added) and push:
      \`git -C ~/.claude/skills/<id> remote add myfork <fork-url>\`
      \`git -C ~/.claude/skills/<id> push -u myfork <branch-name>\`
   d. \`claude-sharester set-branch <id> <branch-name> --remote <fork-url>\` then
      \`claude-sharester sync\`.
6. Once the branch exists, keep it live: commit and push every further edit right
   away rather than batching them. Anyone who has pointed their own \`set-branch\` at
   this branch/fork gets the update automatically on their next sync — that's the
   point of formalizing, instant feedback with no manual pulling on their end.
   (claude-sharester also rebases the branch onto the latest main on every sync, so
   files the branch doesn't touch stay current for everyone pointed at it.)
7. When ready, open a PR from the fork's branch against the source repo.
8. Once merged (or to stop testing), clear the override:
   \`claude-sharester clear-branch <id>\` then \`claude-sharester sync\`.
   This also happens automatically — if the branch is deleted on the fork, the next
   sync detects it and reverts to main on its own.`;

function skillMarkdown() {
  return `---
name: ${SKILL_NAME}
description: Use when asked to modify, fix, or update a skill or command installed via claude-sharester (lives under ~/.claude/skills/<prefix>-<name>/ or ~/.claude/commands/<prefix>-<name>.md). Teaches editing the real source clone (not the generated output, which gets overwritten by sync), offering — not forcing — a branch/fork once edits accumulate, and keeping that branch pushed so teammates pointed at it get live updates.
---

# Editing a skill or command synced by claude-sharester

${GUIDANCE_BODY}
`;
}

function claudeMdSection() {
  return `${START_MARKER}
## Editing Skills/Commands Synced via claude-sharester

${GUIDANCE_BODY}
${END_MARKER}`;
}

export function isSkillInstalled() {
  return existsSync(SKILL_PATH);
}

export function isClaudeMdSnippetInstalled() {
  return existsSync(CLAUDE_MD_PATH) && readFileSync(CLAUDE_MD_PATH, 'utf8').includes(START_MARKER);
}

export function isGuidanceInstalled() {
  return isSkillInstalled() || isClaudeMdSnippetInstalled();
}

export function installSkill() {
  mkdirSync(dirname(SKILL_PATH), { recursive: true });
  writeFileSync(SKILL_PATH, skillMarkdown(), 'utf8');
  return SKILL_PATH;
}

export function installClaudeMdSnippet() {
  const section = claudeMdSection();

  if (!existsSync(CLAUDE_MD_PATH)) {
    mkdirSync(dirname(CLAUDE_MD_PATH), { recursive: true });
    writeFileSync(CLAUDE_MD_PATH, `${section}\n`, 'utf8');
    return CLAUDE_MD_PATH;
  }

  const existing = readFileSync(CLAUDE_MD_PATH, 'utf8');
  if (existing.includes(START_MARKER)) {
    const re = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`);
    writeFileSync(CLAUDE_MD_PATH, existing.replace(re, section), 'utf8');
  } else {
    writeFileSync(CLAUDE_MD_PATH, `${existing.trimEnd()}\n\n---\n\n${section}\n`, 'utf8');
  }
  return CLAUDE_MD_PATH;
}

export async function promptInstallGuidance({ skipIfInstalled = true } = {}) {
  if (skipIfInstalled && isGuidanceInstalled()) return;

  console.log(chalk.bold("\nTeach your AI assistant how to safely branch a teammate's synced skill/command?"));
  console.log(chalk.dim('Editing synced output directly gets overwritten by the next sync — this installs\nguidance on the fork-and-branch workflow instead.'));

  const choice = await choose('Install where?', [
    'Global skill (~/.claude/skills/)',
    'Snippet in ~/.claude/CLAUDE.md',
    'Both',
    'Skip for now',
  ]);

  if (choice.startsWith('Global skill') || choice === 'Both') {
    console.log(chalk.green(`Installed skill: ${installSkill()}`));
  }
  if (choice.startsWith('Snippet') || choice === 'Both') {
    console.log(chalk.green(`Updated: ${installClaudeMdSnippet()}`));
  }
  if (choice === 'Skip for now') {
    console.log(chalk.dim('Skipped. Run `claude-sharester agent-guidance` anytime to set this up.'));
  }
}

// Throttled reminder for commands that don't otherwise prompt for this, so
// users who skipped setup during `init` are periodically nudged instead of
// nagged on every single command.
export function maybeNudgeAgentGuidance() {
  if (isGuidanceInstalled()) return;

  const config = loadConfig();
  const now = Date.now();
  if (now - (config.lastAgentGuidanceNudge ?? 0) < NUDGE_INTERVAL_MS) return;

  config.lastAgentGuidanceNudge = now;
  saveConfig(config);

  console.log(chalk.dim("\nTip: your AI assistant doesn't yet know how to safely branch a synced skill/command."));
  console.log(chalk.dim('Run `claude-sharester agent-guidance` to teach it the fork-and-branch workflow.'));
}
