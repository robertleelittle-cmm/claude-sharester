import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.claude', 'sharester.json');
const SKILLS_DIR = join(homedir(), '.claude', 'skills');
const COMMANDS_DIR = join(homedir(), '.claude', 'commands');
const SCRIPTS_DIR = join(homedir(), '.claude', 'scripts');

const DEFAULT_CONFIG = { sources: [] };

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    throw new Error(`Failed to parse config at ${CONFIG_PATH}`);
  }
}

export function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function ensureDirs() {
  for (const dir of [SKILLS_DIR, COMMANDS_DIR, SCRIPTS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function getSkillsDir() { return SKILLS_DIR; }
export function getCommandsDir() { return COMMANDS_DIR; }
export function getScriptsDir() { return SCRIPTS_DIR; }
export function getConfigPath() { return CONFIG_PATH; }
