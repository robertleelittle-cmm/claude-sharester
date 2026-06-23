import { symlinkSync, unlinkSync, readdirSync, lstatSync, existsSync, readlinkSync } from 'fs';
import { join, basename } from 'path';
import { getCommandsDir, getScriptsDir } from './config.js';

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
