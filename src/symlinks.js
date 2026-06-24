import { symlinkSync, unlinkSync, readdirSync, lstatSync, existsSync, readlinkSync, mkdirSync, rmdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join, basename } from 'path';
import { getCommandsDir, getScriptsDir, getSkillsDir } from './config.js';

export function syncSymlinks(prefix, commands, scripts = []) {
  const commandsDir = getCommandsDir();
  const scriptsDir = getScriptsDir();
  const created = [];
  const skipped = [];

  for (const { commandName, filePath } of commands) {
    const linkName = `${prefix}-${commandName}`;
    const linkPath = join(commandsDir, linkName);
    _ensureSymlink(linkPath, filePath, linkName, created, skipped);
  }

  for (const { scriptName, filePath } of scripts) {
    const linkName = `${prefix}-${scriptName}`;
    const linkPath = join(scriptsDir, linkName);
    _ensureSymlink(linkPath, filePath, linkName, created, skipped);
  }

  return { created, skipped };
}

// Write ~/.claude/skills/<prefix>-<skillName>/SKILL.md for each skill.
// Rewrites the name: field to the prefixed dir name so Claude Code shows the
// skill with the source prefix rather than the skill's internal name.
// Returns the set of dir names written so the caller can prune obsolete dirs.
export function syncSkillDirs(prefix, skills) {
  const skillsDir = getSkillsDir();
  const created = [];
  const skipped = [];

  for (const { skillName, filePath } of skills) {
    const dirName = `${prefix}-${skillName}`;
    const skillDir = join(skillsDir, dirName);
    const destPath = join(skillDir, 'SKILL.md');

    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      skipped.push(dirName);
      continue;
    }

    // Rewrite name: to include the source prefix so the skill appears in
    // Claude Code as /prefix-skillName instead of its internal /skillName.
    const namespaced = content.replace(/^(name:\s*).+$/m, `$1${dirName}`);

    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

    // Remove a stale symlink from the previous approach before writing a real file
    if (existsSync(destPath) && lstatSync(destPath).isSymbolicLink()) unlinkSync(destPath);

    if (existsSync(destPath)) {
      try {
        if (readFileSync(destPath, 'utf8') === namespaced) {
          skipped.push(dirName);
          continue;
        }
      } catch { /* overwrite */ }
    }

    writeFileSync(destPath, namespaced, 'utf8');
    created.push(dirName);
  }

  return { created, skipped };
}

// Remove <prefix>-* skill dirs that are no longer in the current skills set.
export function pruneObsoleteSkillDirs(prefix, currentDirNames) {
  const skillsDir = getSkillsDir();
  if (!existsSync(skillsDir)) return [];
  const keep = new Set(currentDirNames);
  const removed = [];
  for (const entry of readdirSync(skillsDir)) {
    if (!entry.startsWith(`${prefix}-`)) continue;
    if (keep.has(entry)) continue;
    const skillDir = join(skillsDir, entry);
    try {
      if (!lstatSync(skillDir).isDirectory()) continue;
      // Only remove dirs that contain a SKILL.md to avoid touching git clones
      if (!existsSync(join(skillDir, 'SKILL.md'))) continue;
      rmSync(skillDir, { recursive: true, force: true });
      removed.push(entry);
    } catch { /* ignore */ }
  }
  return removed;
}

// Remove command symlinks that were promoted to skills so they don't appear in both places.
export function demoteCommandLinks(prefix, skillNames) {
  const commandsDir = getCommandsDir();
  for (const name of skillNames) {
    const linkPath = join(commandsDir, `${prefix}-${name}.md`);
    try {
      if (lstatSync(linkPath).isSymbolicLink()) unlinkSync(linkPath);
    } catch { /* not there, fine */ }
  }
}

export function removeSourceSymlinks(prefix) {
  const removed = [];
  for (const [dir] of [[getCommandsDir()], [getScriptsDir()]]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith(`${prefix}-`)) continue;
      const linkPath = join(dir, entry);
      try {
        unlinkSync(linkPath);
        removed.push(entry);
      } catch {
        // ignore
      }
    }
  }
  return removed;
}

// Remove all <prefix>-* skill dirs for this source (used on source remove).
export function removeSourceSkillDirs(prefix) {
  const skillsDir = getSkillsDir();
  if (!existsSync(skillsDir)) return [];
  const removed = [];
  for (const entry of readdirSync(skillsDir)) {
    if (!entry.startsWith(`${prefix}-`)) continue;
    const skillDir = join(skillsDir, entry);
    try {
      if (!lstatSync(skillDir).isDirectory()) continue;
      if (!existsSync(join(skillDir, 'SKILL.md'))) continue;
      rmSync(skillDir, { recursive: true, force: true });
      removed.push(entry);
    } catch { /* ignore */ }
  }
  return removed;
}

export function pruneStaleSymlinks(prefix) {
  const removed = [];
  for (const dir of [getCommandsDir(), getScriptsDir()]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith(`${prefix}-`)) continue;
      const linkPath = join(dir, entry);
      try {
        const stat = lstatSync(linkPath);
        if (!stat.isSymbolicLink()) continue;
        const target = readlinkSync(linkPath);
        if (!existsSync(target)) {
          unlinkSync(linkPath);
          removed.push(entry);
        }
      } catch {
        // ignore
      }
    }
  }
  return removed;
}

function _ensureSymlink(linkPath, target, linkName, created, skipped) {
  if (existsSync(linkPath)) {
    try {
      const stat = lstatSync(linkPath);
      if (stat.isSymbolicLink() && readlinkSync(linkPath) === target) {
        skipped.push(linkName);
        return;
      }
      unlinkSync(linkPath);
    } catch {
      skipped.push(linkName);
      return;
    }
  }
  symlinkSync(target, linkPath);
  created.push(linkName);
}
