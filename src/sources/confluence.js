import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { getSkillsDir } from '../config.js';

export async function syncConfluence(source) {
  const { CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN } = process.env;

  if (!CONFLUENCE_BASE_URL || !CONFLUENCE_EMAIL || !CONFLUENCE_API_TOKEN) {
    throw new Error(
      'Confluence auth env vars required: CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN'
    );
  }

  const credentials = Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_API_TOKEN}`).toString('base64');
  const url = `${CONFLUENCE_BASE_URL}/rest/api/content/${source.pageId}?expand=body.storage`;

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Confluence API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const storageBody = data.body?.storage?.value ?? '';
  const blocks = parseCodeBlocks(storageBody);

  const outDir = join(getSkillsDir(), source.id, 'commands');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const commands = [];
  for (const { name, content } of blocks) {
    const fileName = `${name}.md`;
    const filePath = join(outDir, fileName);
    writeFileSync(filePath, content, 'utf8');
    commands.push({ commandName: fileName, filePath });
  }

  return { commands, scripts: [] };
}

function parseCodeBlocks(storageXml) {
  const results = [];
  // Match Confluence code macro blocks: <ac:structured-macro ac:name="code">
  const macroRegex =
    /<ac:structured-macro[^>]+ac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
  const titleParamRegex = /<ac:parameter ac:name="title">([\s\S]*?)<\/ac:parameter>/;
  const bodyRegex = /<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/;

  // Track headings before each macro for fallback naming
  const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g;
  const headings = [];
  let hMatch;
  while ((hMatch = headingRegex.exec(storageXml)) !== null) {
    headings.push({ index: hMatch.index, text: stripTags(hMatch[1]) });
  }

  let match;
  let counter = 1;
  while ((match = macroRegex.exec(storageXml)) !== null) {
    const macroContent = match[1];
    const bodyMatch = bodyRegex.exec(macroContent);
    if (!bodyMatch) continue;

    const content = bodyMatch[1].trim();
    if (!content) continue;

    // Prefer explicit title param, fall back to nearest preceding heading
    let name;
    const titleMatch = titleParamRegex.exec(macroContent);
    if (titleMatch) {
      name = slugify(stripTags(titleMatch[1]));
    } else {
      const preceding = headings.filter(h => h.index < match.index).pop();
      name = preceding ? slugify(preceding.text) : `command-${counter}`;
    }

    results.push({ name, content });
    counter++;
  }

  return results;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').trim();
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
