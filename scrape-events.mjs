import * as chrono from 'chrono-node';
import fs from "fs/promises";
import path from "path";


import { browser, scrape } from "./scrape/index.mjs";

async function saveToFile(data, filename) {
  try {
    const outputPath = path.join(process.cwd(), "scraped-data");
    await fs.mkdir(outputPath, { recursive: true });
    const filePath = path.join(outputPath, filename);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`Data successfully saved to ${filePath}`);
  }
  catch (error) {
    console.error(`Error saving data to ${filename}:`, error);
    throw error;
  }
}

const formatDate = (dateString) => {
  if (!dateString)
    return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime()))
    return null;
  return date.toISOString().split("T")[0];
};

const cleanTitle = (rawTitle) => {
  const monthRegex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:[a-z]*)?/i;
  const parts = rawTitle.split("–");

  return parts.filter(part => !monthRegex.test(part.toLowerCase())).join().trim();
};

const getDateRanges = (content) => {
  return chrono
    .parse(content)
    .map((x) =>
      x.end // continous date - [start, end]
        ? [
          x.start.date().toISOString().split('T')[0],
          x.end.date().toISOString().split('T')[0],
        ]
        // fixed date - start
        : x.start.date().toISOString().split('T')[0]
    )
}

const getEventDetails = async (page, event) => {
  if (!event.link) {
    return { ...event, content: [], images: [] };
  }
  try {
    await page.goto(event.link, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".fl-post");

    return await page.evaluate(() => {
      const rawDate =
        document.querySelector('meta[itemprop="datePublished"]')?.content ||
        document.querySelector(".fl-post-date")?.textContent?.trim() ||
        null;

      const formattedDate = rawDate
        ? new Date(rawDate).toISOString().split("T")[0]
        : null;

      const title =
        document.querySelector(".fl-post-title")?.textContent?.trim() || null;

      const authorMeta = document.querySelector('meta[itemprop="author"]');
      const author =
        authorMeta?.content ||
        document.querySelector(".fl-post-author span")?.textContent?.trim() ||
        null;

      const thumbnail =
        document.querySelector('[itemprop="image"] meta[itemprop="url"]')
          ?.content || null;

      const tags = document.querySelectorAll(".fl-post-cats-tags a");
      const isNews = Array.from(tags).some((a) =>
        a.href.toLowerCase().includes("/category/news/")
      );
      if (isNews) return null;

      const contentEl = document.querySelector(".fl-post-content");
      if (!contentEl) return null;

      const images = [];

      // 1. Handle <figure><a><img> with high-res link in <a href>
      const figureLinks = contentEl.querySelectorAll("figure.wp-block-image a");
      figureLinks.forEach((a) => {
        const href = a.getAttribute("href");
        if (href && /\.(jpg|jpeg|png|webp)$/i.test(href)) {
          images.push({ url: href, caption: null });
        }
      });

      // 2. Handle any <img> inside content not in figures
      const imgTags = contentEl.querySelectorAll("img");
      imgTags.forEach((img) => {
        const src = img.getAttribute("src");
        const parentLink = img.closest("a");

        // Skip if already handled above
        if (parentLink && parentLink.getAttribute("href") === src) return;

        if (src && /\.(jpg|jpeg|png|webp)$/i.test(src)) {
          const cleaned = src.replace(
            /-\d+x\d+(?=\.(jpg|jpeg|png|webp)$)/i,
            ""
          );
          if (!images.some((img) => img.url === cleaned)) {
            images.push({ url: cleaned, caption: null });
          }
        }
      });

      const content = contentEl.innerText.trim();

      return {
        title,
        link: window.location.href,
        author,
        datePublished: formattedDate,
        thumbnail,
        images,
        content,
      };
    });
  } catch (error) {
    console.error(`Error fetching event details for link: ${event.link}`, error);
    return { ...event, images: [], content: [] };
  }
};

const scrapeEvents = async (page, index = 0, scraped = []) => {
  const url = "https://www.goldenstate.edu.ph/category/events/page/" + ++index;
  console.log(`scraping: ${url}`);
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (response.status() === 404) return scraped.flat();
    await page.waitForSelector(".fl-post", { timeout: 3000 });
  } catch (e) {
    return scraped.flat();
  }

  const events = await page.evaluate(() => {
    const eventElements = document.querySelectorAll(".fl-post");
    return Array.from(eventElements).map((event) => ({
      rawTitle: event.querySelector(".fl-post-title a")?.textContent?.trim() || "",
      link: event.querySelector(".fl-post-title a")?.href || null,
      datePublished: event.querySelector(".fl-post-date")?.textContent?.trim() || null,
      dateModified: event.querySelector('meta[itemprop="dateModified"]')?.getAttribute("content") || null,
    }));
  }).then((events) => events.map(({ rawTitle, link, datePublished, dateModified,  }) => {
    const title = cleanTitle(rawTitle).replace("20025", "2025");
    return {
      title,
      link,
      datePublished: formatDate(datePublished),
      dateModified: formatDate(dateModified),
      content: ""
    };
  }));

  const _events = [];
  for (const event of events) {

    const detailPage = await scrape(event.link);
    const detailedEvent = detailPage ? await getEventDetails(detailPage, event) : { ...event, fullContent: null, images: [] };
    if (!detailedEvent) {
      console.log(`News content got lost in events! [${event.link}]`)
      continue;
    }

    _events.push({
      title: cleanTitle(detailedEvent.title).replace("20025", "2025"),
      link: detailedEvent.link,
      author: detailedEvent.author,
      dateRange: getDateRanges((detailedEvent.content).replace("20025", "2025")),
      datePublished: event.datePublished,
      thumbnail: detailedEvent.thumbnail,
      content: detailedEvent.content,
      images: detailedEvent.images,
    })
  }
  scraped.push(_events)

  console.log(scraped.length, scraped[index - 1].length, scraped.flat().length);
  return scrapeEvents(page, index, scraped)
};

async function main() {
  try {
    const eventPage = await scrape("https://www.goldenstate.edu.ph");
    if (eventPage) {
      const events = await scrapeEvents(eventPage);
      await saveToFile(events, "events.json");
    }
  }
  catch (error) {
    console.error("Scraping error:", error);
  }
  finally {
    await browser?.close();
  }
}
main();