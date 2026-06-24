import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
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

  const headers = {
    Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
    Accept: 'application/json',
  };

  const pageId = await resolvePageId(baseUrl, source.pageId, headers);
  const res = await fetch(`${baseUrl}/rest/api/content/${pageId}?expand=body.storage`, { headers });

  if (!res.ok) throw new Error(`Confluence API error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const storageBody = data.body?.storage?.value ?? '';

  const outDir = join(getSkillsDir(), source.id, 'commands');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Mode 1: page has child pages → each child page is one command (hub/index pattern)
  const childRes = await fetch(
    `${baseUrl}/rest/api/content/${pageId}/child/page?expand=body.storage&limit=50`,
    { headers }
  );
  if (childRes.ok) {
    const childData = await childRes.json();
    const children = childData.results ?? [];
    if (children.length > 0) {
      const commands = [];
      for (const child of children) {
        const childStorage = child.body?.storage?.value ?? '';
        if (!childStorage.trim()) continue;
        const name = titleToCommandName(child.title);
        if (!name) continue;
        const content = storageXmlToMarkdown(childStorage);
        const fileName = `${name}.md`;
        const filePath = join(outDir, fileName);
        writeFileSync(filePath, content, 'utf8');
        commands.push({ commandName: fileName, filePath });
      }
      pruneOutDir(outDir, commands.map(c => c.commandName));
      return { commands, scripts: [] };
    }
  }

  // Mode 2: no child pages → extract code macro blocks from the page itself
  const codeBlocks = parseCodeBlocks(storageBody);
  const commands = [];
  for (const { name, content } of codeBlocks) {
    const fileName = `${name}.md`;
    const filePath = join(outDir, fileName);
    writeFileSync(filePath, content, 'utf8');
    commands.push({ commandName: fileName, filePath });
  }
  pruneOutDir(outDir, commands.map(c => c.commandName));
  return { commands, scripts: [] };
}

// Remove files in outDir that are no longer in the current command set, so
// pruneStaleSymlinks can clean up their symlinks on the next pass.
function pruneOutDir(outDir, currentFileNames) {
  const keep = new Set(currentFileNames);
  for (const f of readdirSync(outDir)) {
    if (!keep.has(f)) unlinkSync(join(outDir, f));
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function resolvePageId(baseUrl, pageId, headers) {
  if (/^\d+$/.test(pageId)) return pageId;
  // Tiny link — follow the redirect to extract the numeric ID
  const res = await fetch(`${baseUrl}/x/${pageId}`, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not resolve Confluence page "${pageId}": ${res.status}`);
  const match = res.url.match(/\/pages\/(\d+)/);
  if (!match) throw new Error(`Could not extract page ID from resolved URL: ${res.url}`);
  return match[1];
}

// "/argo-deploy — Skill Source" → "argo-deploy"
// "/pr-finalize — Command Source" → "pr-finalize"
function titleToCommandName(title) {
  const clean = title
    .replace(/\s*[—–-]+\s*(Skill|Command)\s+Source\s*$/i, '')
    .replace(/^\//, '')
    .trim();
  return slugify(clean);
}

// Convert Confluence storage XML to readable markdown
function storageXmlToMarkdown(xml) {
  let out = xml;

  // Code macro blocks → fenced code
  out = out.replace(
    /<ac:structured-macro[^>]+ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g,
    (_, code) => `\`\`\`\n${code.trim()}\n\`\`\`\n`
  );

  // Headings
  for (let n = 6; n >= 1; n--) {
    out = out.replace(new RegExp(`<h${n}[^>]*>([\\s\\S]*?)<\\/h${n}>`, 'g'),
      (_, t) => `${'#'.repeat(n)} ${stripTags(t).trim()}\n`);
  }

  // Bold / italic
  out = out.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/g, (_, t) => `**${stripTags(t)}**`);
  out = out.replace(/<em[^>]*>([\s\S]*?)<\/em>/g, (_, t) => `_${stripTags(t)}_`);

  // Inline code
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/g, (_, t) => `\`${stripTags(t)}\``);

  // Links
  out = out.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
    (_, href, t) => `[${stripTags(t)}](${href})`);

  // Table rows — convert to | separated cols, then strip table wrappers
  out = out.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/g, (_, row) => {
    const cells = [];
    row.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g, (__, cell) => {
      cells.push(stripTags(cell).trim());
    });
    return `| ${cells.join(' | ')} |\n`;
  });
  out = out.replace(/<\/?t(?:able|body|head|foot)[^>]*>/g, '');

  // List items
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_, t) => `- ${stripTags(t).trim()}\n`);
  out = out.replace(/<\/?[uo]l[^>]*>/g, '\n');

  // Paragraphs / breaks
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_, t) => `${stripTags(t).trim()}\n\n`);

  // Horizontal rules
  out = out.replace(/<hr[^>]*\/?>/gi, '\n---\n');

  // Strip any remaining XML/HTML tags
  out = stripTags(out);

  // Decode common HTML entities
  out = out
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Normalise blank lines
  return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function parseCodeBlocks(storageXml) {
  const results = [];
  const macroRegex =
    /<ac:structured-macro[^>]+ac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
  const titleParamRegex = /<ac:parameter ac:name="title">([\s\S]*?)<\/ac:parameter>/;
  const bodyRegex = /<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/;

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
