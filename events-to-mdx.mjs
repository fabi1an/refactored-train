// transform-json-to-mdx.mjs
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { normalizeText } from 'normalize-text';
import { EnglishSpellingNormalizer } from '@shelf/text-normalizer';
import transformTitle from 'title';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const spellingNormalizer = new EnglishSpellingNormalizer();

const toKey = (dateStr) => {
  const date = new Date(dateStr);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
};

const toMDX = ({ title, author, datePublished, content }) => `---\ntitle: "${title}"\nauthor: "${author}"\ndatePublished: "${datePublished}"\n---\n\n${content.join('\n\n')}`;

// Load events
const raw = await readFile(join(__dirname, 'scraped-data', 'events.json'), 'utf-8');
const events = JSON.parse(raw);

const seenTitles = new Set();

// Group by date folder
const grouped = {};
for (const event of events) {
  const titleKey = normalizeText(event.title).toLowerCase().trim();
  if (seenTitles.has(titleKey)) continue; // skip duplicates
  seenTitles.add(titleKey);

  const date = new Date(event.datePublished);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const key = `${yyyy}/${mm}/${dd}`;

  if (!grouped[key]) grouped[key] = [];
  grouped[key].push(event);
}

await rm(join(__dirname, 'events'), { force: true, recursive: true });

const writeTasks = [];

for (const [key, group] of Object.entries(grouped)) {
  group.sort((a, b) => {
    const d1 = new Date(a.datePublished);
    const d2 = new Date(b.datePublished);
    const diff = d1 - d2;
    if (diff !== 0) return diff;

    return events.indexOf(b) - events.indexOf(a);
  });

  const dir = join(__dirname, 'events', ...key.split('/'));
  await mkdir(dir, { recursive: true });

  group.forEach((event, i) => {
    const title = transformTitle(spellingNormalizer.normalize(normalizeText(event.title)));
    const slug = normalizeText(event.title)
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-+|-+$/g, '');

    const formatDate = (dateString) => {
  if (!dateString)
    return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime()))
    return null;
  return date.toISOString().split("T")[0];
};

    const formattedDateRange = event.dateRange.map((y) => !Array.isArray(y) ? formatDate(y): y.map((dateRange) =>  formatDate(dateRange)))
    const mdx = `---\n` +
      `slug: "${slug}"\n` +
      `title: "${title}"\n` +
      `datePublished: "${formatDate(event.datePublished)}"\n` +
      `dateRange: [${formattedDateRange.map((y) => !Array.isArray(y) ? `"${y}"` : `[${y.map((x) =>`"${x}"`).join(", ")}]`).join(", ")}]\n` +
      `---\n\n` +
      `<!--- content start --->\n\n` +
  (event.content.length ? `${event.content.trim()}\n\n` : "") +
      `<!--- content end --->\n`;

    const filename = String(i + 1).padStart(3, '0') + '.mdx';
    const outputPath = join(dir, filename);
    writeTasks.push(writeFile(outputPath, mdx.trim()).then(() =>{
      console.log((title))
      console.log('✅ Created:', outputPath)
    }
    ));
  });

}

await Promise.all(writeTasks);
