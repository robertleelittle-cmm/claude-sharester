import { symlinkSync, unlinkSync, readdirSync, lstatSync, existsSync, readlinkSync, mkdirSync, rmdirSync } from 'fs';
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

// Create ~/.claude/skills/<prefix>-<skillName>/SKILL.md symlinks for each skill.
export function syncSkillDirs(prefix, skills) {
  const skillsDir = getSkillsDir();
  const created = [];
  const skipped = [];

  for (const { skillName, filePath } of skills) {
    const dirName = `${prefix}-${skillName}`;
    const skillDir = join(skillsDir, dirName);
    const linkPath = join(skillDir, 'SKILL.md');
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
    _ensureSymlink(linkPath, filePath, dirName, created, skipped);
  }

  return { created, skipped };
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

// Remove ~/.claude/skills/<prefix>-*/ directories created by syncSkillDirs.
export function removeSourceSkillDirs(prefix) {
  const skillsDir = getSkillsDir();
  if (!existsSync(skillsDir)) return [];
  const removed = [];
  for (const entry of readdirSync(skillsDir)) {
    if (!entry.startsWith(`${prefix}-`)) continue;
    const skillDir = join(skillsDir, entry);
    try {
      if (!lstatSync(skillDir).isDirectory()) continue;
      const linkPath = join(skillDir, 'SKILL.md');
      if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
        unlinkSync(linkPath);
        try { rmdirSync(skillDir); } catch { /* not empty */ }
        removed.push(entry);
      }
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

// Remove skill dirs whose SKILL.md symlink targets no longer exist.
export function pruneStaleSkillDirs(prefix) {
  const skillsDir = getSkillsDir();
  if (!existsSync(skillsDir)) return [];
  const removed = [];
  for (const entry of readdirSync(skillsDir)) {
    if (!entry.startsWith(`${prefix}-`)) continue;
    const skillDir = join(skillsDir, entry);
    try {
      if (!lstatSync(skillDir).isDirectory()) continue;
      const linkPath = join(skillDir, 'SKILL.md');
      const linkStat = lstatSync(linkPath);
      if (!linkStat.isSymbolicLink()) continue;
      if (!existsSync(readlinkSync(linkPath))) {
        unlinkSync(linkPath);
        try { rmdirSync(skillDir); } catch { /* not empty */ }
        removed.push(entry);
      }
    } catch { /* ignore */ }
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
