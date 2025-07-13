// transform-json-to-mdx.mjs
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { normalizeText, normalizeName, normalizeParagraph } from 'normalize-text';
import { EnglishSpellingNormalizer } from '@shelf/text-normalizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const spellingNormalizer = new EnglishSpellingNormalizer();

// Utility: Normalize & slugify title
const slugify = (str) =>
  normalizeText(str)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')    // remove non-word chars
    .replace(/\s+/g, '-')        // spaces to dashes
    .replace(/--+/g, '-')        // collapse dashes
    .replace(/^-+|-+$/g, '')     // trim
    .slice(0, 60);               // limit length

// Utility: Build MDX content
const toMDX = ({ title, author, datePublished, content }) => `---\ntitle: "${title}"\nauthor: "${author}"\ndatePublished: "${datePublished}"\n---\n\n${content.join('\n\n')}`;

// Main
const raw = await readFile(join(__dirname, 'scraped-data', 'articles.json'), 'utf-8');
const articles = JSON.parse(raw);

await rm(join(__dirname, 'news'), { force: true, recursive: true });

await Promise.all(
  articles.map(async (news) => {
    const date = new Date(news.datePublished);
    const [yyyy, mm, dd] = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ];

    const dir = join(__dirname, 'news', yyyy.toString(), mm, dd);
    await mkdir(dir, { recursive: true });

    const title = spellingNormalizer.normalize(normalizeText(news.title));
    const author = normalizeName(news.author);
    const content = news.content.map(p =>
      spellingNormalizer.normalize(normalizeParagraph(normalizeText(p)))
    );

    const mdx = toMDX({ title, author, datePublished: news.datePublished, content });
    const filename = `${slugify(news.title)}.mdx`;
    const outputPath = join(dir, filename);

    await writeFile(outputPath, mdx.trim());
    console.log('✅ Created:', outputPath);
  })
);
