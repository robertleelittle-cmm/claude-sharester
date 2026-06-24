import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { getSkillsDir } from '../config.js';

export async function syncConfluence(source) {
  const baseUrl = process.env.CONFLUENCE_BASE_URL
    ?? (process.env.JIRA_BASE_URL ? `${process.env.JIRA_BASE_URL}/wiki` : undefined);
  const email = process.env.CONFLUENCE_EMAIL ?? process.env.JIRA_EMAIL;
  const token = process.env.CONFLUENCE_API_TOKEN ?? process.env.JIRA_API_TOKEN;

  if (!baseUrl || !email || !token) {
    throw new Error(
      'Confluence auth required: set JIRA_BASE_URL/EMAIL/API_TOKEN (or CONFLUENCE_BASE_URL/EMAIL/API_TOKEN). Run `claude-sharester init` to configure.'
    );
  }

  const credentials = Buffer.from(`${email}:${token}`).toString('base64');
  const pageId = await resolvePageId(baseUrl, source.pageId, credentials);
  const url = `${baseUrl}/rest/api/content/${pageId}?expand=body.storage`;

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

async function resolvePageId(baseUrl, pageId, credentials) {
  if (/^\d+$/.test(pageId)) return pageId;
  // Tiny link — follow the redirect to extract the numeric ID
  const tinyUrl = `${baseUrl}/x/${pageId}`;
  const res = await fetch(tinyUrl, {
    headers: { Authorization: `Basic ${credentials}` },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Could not resolve Confluence page "${pageId}": ${res.status}`);
  // Final URL contains the numeric page ID in its path
  const finalUrl = res.url;
  const match = finalUrl.match(/\/pages\/(\d+)/);
  if (!match) throw new Error(`Could not extract page ID from resolved URL: ${finalUrl}`);
  return match[1];
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
