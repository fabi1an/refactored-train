
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
const monthMap = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12"
};


  const normalizeMonth = (m) =>
    monthMap[m.toLowerCase().replace(/[^a-z0-9 ]/g, '')] || null;

  const toISO = (month, day, year) => {
    const mm = normalizeMonth(month);
    const dd = String(day).padStart(2, '0');
    if (!mm) return null;
    return `${year}-${mm}-${dd}`;
  };

function getDateRanges(eventStr) {
  if (!eventStr) return [];

  const result = [];

  const yearMatch = eventStr.match(/\b(20\d{2})\b/);
  const year = yearMatch?.[1];
  if (!year) return [];

  const beforeYear = eventStr.split(/\b20\d{2}\b/)[0];

  // Match month and a group of days like: "June 25,26" or "May 20,25-26"
  const mixed = beforeYear.match(/([A-Za-z.]+)\s+([\d\s,–&-]+)/);
  if (mixed) {
    const [, monthRaw, dayStr] = mixed;
    const entries = dayStr
      .split(/,|\s+|&/)
      .map(s => s.trim())
      .filter(Boolean);

    for (const entry of entries) {
      if (/^(\d+)[-–](\d+)$/.test(entry)) {
        // Explicit range
        const [, start, end] = entry.match(/^(\d+)[-–](\d+)$/);
        const startDate = toISO(monthRaw, start, year);
        const endDate = toISO(monthRaw, end, year);
        if (startDate && endDate) result.push([startDate, endDate]);
      }
    }

    // Gather remaining pure numbers
    const pureDays = entries
      .filter(e => /^\d+$/.test(e))
      .map(Number)
      .sort((a, b) => a - b);

    if (pureDays.length > 0) {
      let temp = [pureDays[0]];

      for (let i = 1; i <= pureDays.length; i++) {
        if (pureDays[i] === pureDays[i - 1] + 1) {
          temp.push(pureDays[i]);
        } else {
          if (temp.length > 1) {
            const start = toISO(monthRaw, temp[0], year);
            const end = toISO(monthRaw, temp[temp.length - 1], year);
            result.push([start, end]);
          } else {
            const fixed = toISO(monthRaw, temp[0], year);
            result.push([fixed]);
          }
          temp = [pureDays[i]];
        }
      }
    }

    return result;
  }

  // Fallback: single fixed date
  const single = beforeYear.match(/([A-Za-z.]+)\s+(\d{1,2})/);
  if (single) {
    const [_, month, day] = single;
    const date = toISO(month, day, year);
    if (date) result.push([date]);
  }

  return result;
}

const cleanTitle = (rawTitle) => {
  const monthRegex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:[a-z]*)?/i;
  const parts = rawTitle.split("–");
  
  return parts.filter(part => !monthRegex.test(part.toLowerCase())).join().trim();
};

const getEventDetails = async (page, event) => {
  if (!event.link) {
    return { ...event, content: [], images: [] };
  }
  try {
    await page.goto(event.link, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".fl-post");
    return await page.evaluate(() => {
      const rawDate = document.querySelector('meta[itemprop="datePublished"]')?.content ||
        document.querySelector(".fl-post-date")?.textContent?.trim() ||
        null;
      const formattedDate = rawDate ? new Date(rawDate).toISOString().split("T")[0] : null;
      const title = document.querySelector(".fl-post-title")?.textContent?.trim() || null;
      const authorMeta = document.querySelector('meta[itemprop="author"]');
      const author = authorMeta?.content || document.querySelector(".fl-post-author span")?.textContent?.trim() || null;
      const thumbnail = document.querySelector('[itemprop="image"] meta[itemprop="url"]')?.content || null;
      const paragraphs = Array.from(document.querySelectorAll(".fl-post-content p"))
        .map((p) => p.textContent?.trim() || "")
        .filter((text) => text !== "" && text !== "&nbsp;");
      const images = [];

            const tags = document.querySelectorAll(".fl-post-cats-tags a");
      const isNews = Array.from(tags).some((a) =>
        a.href.toLowerCase().includes("/category/news/")
      );
      if (isNews) return null;


      const content = document.querySelector(".fl-post-content");
      if (!content) return null;

      // 1. Handle <figure><a><img> with high-res link in <a href>
      const figureLinks = content.querySelectorAll("figure.wp-block-image a");
      figureLinks.forEach(a => {
        const href = a.getAttribute("href");
        if (href && /\.(jpg|jpeg|png|webp)$/i.test(href)) {
          images.push({ url: href, caption: null });
        }
      });

      // 2. Handle any <img> inside content that wasn't covered above
      const imgTags = content.querySelectorAll("img");
      imgTags.forEach(img => {
        const src = img.getAttribute("src");
        const parentLink = img.closest("a");

        // Already handled above
        if (parentLink && parentLink.getAttribute("href") === src) return;

        if (src && /\.(jpg|jpeg|png|webp)$/i.test(src)) {
          // Skip resized thumbnails
          const cleaned = src.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp)$)/i, '');
          if (!images.some(img => img.url === cleaned)) {
            images.push({ url: cleaned, caption: null });
          }
        }
      });

      return {
        title,
        link: window.location.href,
        author,
        datePublished: formattedDate,
        thumbnail,
        content: paragraphs,
        images,
      };
    });
  }
  catch (error) {
    console.error(`Error fetching event details for link: ${event.link}`, error);
    return { ...event, content: [], images: [] };
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
  }).then((events) => events.map(({ rawTitle, link, datePublished, dateModified }) => {
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
        link:detailedEvent.link,
        author: detailedEvent.author,
        dateRange: getDateRanges(detailedEvent.content?.join("\n")),
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