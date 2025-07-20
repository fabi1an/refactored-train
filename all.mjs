
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
const scrapeCourses = async (page) => {
  await page.goto("https://www.goldenstate.edu.ph", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".fl-row-content.fl-row-fixed-width");
  return await page.evaluate(() => {
    const courseElements = document.querySelectorAll(".fl-row-content.fl-row-fixed-width .fl-col-group-equal-height .fl-col-content");
    return Array.from(courseElements).map((el) => ({
      image: el.querySelector(".pp-infobox-image img")?.src || null,
      title: el.querySelector(".pp-infobox-title-prefix")?.textContent?.trim() || null,
      description: el.querySelector(".pp-infobox-description p")?.textContent?.trim() || null,
    }));
  });
};
const scrapeEvents = async (page) => {
  await page.goto("https://www.goldenstate.edu.ph/category/events/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".fl-post");
  const events = await page.evaluate(() => {
    const eventElements = document.querySelectorAll(".fl-post");
    return Array.from(eventElements).map((event) => ({
      rawTitle: event.querySelector(".fl-post-title a")?.textContent?.trim() || "",
      link: event.querySelector(".fl-post-title a")?.href || null,
      datePublished: event.querySelector(".fl-post-date")?.textContent?.trim() || null,
      dateModified: event.querySelector('meta[itemprop="dateModified"]')?.getAttribute("content") || null,
    }));
  });
  const monthMap = {
    JAN: "01",
    FEB: "02",
    MAR: "03",
    APR: "04",
    MAY: "05",
    JUN: "06",
    JUL: "07",
    AUG: "08",
    SEP: "09",
    OCT: "10",
    NOV: "11",
    DEC: "12",
  };
  const formatDate = (dateString) => {
    if (!dateString)
      return null;
    const date = new Date(dateString);
    if (isNaN(date.getTime()))
      return null;
    return date.toISOString().split("T")[0];
  };
  const processDates = (rawTitle) => {
    const dates = [];
    const crossMonthPattern = /([A-Z]{3})\.\s+(\d{1,2})\s*[–-]\s*([A-Z]{3})\.\s+(\d{1,2}),\s*(\d{4})/;
    const crossMonthMatch = rawTitle.match(crossMonthPattern);
    if (crossMonthMatch) {
      const [, startMonth, startDay, endMonth, endDay, year] = crossMonthMatch;
      const startMonthNum = monthMap[startMonth];
      const endMonthNum = monthMap[endMonth];
      const startDate = new Date(`${year}-${startMonthNum}-${startDay.padStart(2, "0")}`);
      const endDate = new Date(`${year}-${endMonthNum}-${endDay.padStart(2, "0")}`);
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        dates.push(currentDate.toISOString().split("T")[0]);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      return dates;
    }
    const rangePattern = /([A-Z]{3})\.\s+(\d{1,2})-(\d{1,2}),\s*(\d{4})/;
    const rangeMatch = rawTitle.match(rangePattern);
    if (rangeMatch) {
      const [, month, startDay, endDay, year] = rangeMatch;
      const monthNum = monthMap[month];
      const start = parseInt(startDay);
      const end = parseInt(endDay);
      for (let day = start; day <= end; day++) {
        dates.push(`${year}-${monthNum}-${day.toString().padStart(2, "0")}`);
      }
      return dates;
    }
    const multiDayPattern = /([A-Z]{3})\.\s+(\d{1,2}(?:,\s*\d{1,2})*),\s*(\d{4})/;
    const multiDayMatch = rawTitle.match(multiDayPattern);
    if (multiDayMatch) {
      const [, month, daysStr, year] = multiDayMatch;
      const monthNum = monthMap[month];
      const days = daysStr.split(",").map((d) => d.trim());
      days.forEach((day) => {
        if (day) {
          dates.push(`${year}-${monthNum}-${day.padStart(2, "0")}`);
        }
      });
      return dates;
    }
    const singleDayPattern = /([A-Z]{3})\.\s+(\d{1,2}),\s*(\d{4})/;
    const singleDayMatch = rawTitle.match(singleDayPattern);
    if (singleDayMatch) {
      const [, month, day, year] = singleDayMatch;
      dates.push(`${year}-${monthMap[month]}-${day.padStart(2, "0")}`);
      return dates;
    }
    return dates;
  };
  const cleanTitle = (rawTitle) => {
    const parts = rawTitle.split("–");
    return parts.length > 1 ? parts.pop()?.trim() || rawTitle : rawTitle;
  };
  return events.map(({ rawTitle, link, datePublished, dateModified }) => {
    const title = cleanTitle(rawTitle);
    const dateRange = processDates(rawTitle);
    return {
      title,
      link,
      dateRange,
      datePublished: formatDate(datePublished),
      dateModified: formatDate(dateModified),
    };
  });
};
const getMaxPageNumber = async (page) => {
  await page.waitForSelector(".pp-content-grid-pagination", { timeout: 60000 });
  return await page.evaluate(() => {
    const paginationItems = document.querySelectorAll(".pp-content-grid-pagination .page-numbers a");
    const pageNumbers = Array.from(paginationItems).map((item) => parseInt(item.textContent || "0"));
    return Math.max(...pageNumbers.filter((num) => !isNaN(num)));
  });
};
const scrapeArticlesFromPage = async (page) => {
  await page.waitForSelector(".pp-content-post, .fl-post");
  return page.evaluate(() => {
    const articles = document.querySelectorAll(".pp-content-post, .fl-post");
    return Array.from(articles).map((article) => {
      const rawDate = article.querySelector(".pp-post-date, meta[itemprop='datePublished']")?.textContent?.trim() || null;
      const formattedDate = rawDate ? new Date(rawDate).toISOString().split("T")[0] : null;
      return {
        title: article.querySelector(".pp-content-grid-title, .fl-post-title")?.textContent?.trim() || "",
        link: article.querySelector(".pp-post-link, .fl-post-title a")?.href || "",
        author: article.querySelector(".pp-content-post-author span, .fl-post-author span")?.textContent?.trim() || null,
        datePublished: formattedDate,
        content: [],
        images: [],
      };
    });
  });
};
const getArticleDetails = async (page, article) => {
  if (!article.link) {
    return { ...article, content: [], images: [] };
  }
  try {
    await page.goto(article.link, { waitUntil: "domcontentloaded" });
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

      const content = document.querySelector(".fl-post-content");
      if (!content) return images;

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
    console.error(`Error fetching article details for link: ${article.link}`, error);
    return { ...article, content: [], images: [] };
  }
};
const scrapeAllArticles = async (page) => {
  const articles = [];
  console.log("Scraping all articles started...");
  try {
    const maxPageNumber = await getMaxPageNumber(page);
    console.log(`Total pages to scrape: ${maxPageNumber}`);
    for (let i = 1; i <= maxPageNumber; i++) {
      const url = `https://www.goldenstate.edu.ph/news/page/${i}/`;
      console.log(`Scraping page ${i}/${maxPageNumber}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const pageArticles = await scrapeArticlesFromPage(page);
      for (const article of pageArticles) {
        const detailPage = await scrape(article.link);
        const detailedArticle = detailPage ? await getArticleDetails(detailPage, article) : { ...article, fullContent: null, images: [] };
        articles.push(detailedArticle);
      }
    }
  }
  catch (error) {
    console.error("Error during article scraping:", error);
  }
  return articles;
};
async function main() {
  try {
    const coursePage = await scrape("https://www.goldenstate.edu.ph");
    if (coursePage) {
      const courses = await scrapeCourses(coursePage);
      await saveToFile(courses, "courses.json");
    }
    const eventPage = await scrape("https://www.goldenstate.edu.ph");
    if (eventPage) {
      const events = await scrapeEvents(eventPage);
      await saveToFile(events, "events.json");
    }
    // const articlePage = await scrape("https://www.goldenstate.edu.ph/news");
    // if (articlePage) {
    //   const articles = await scrapeAllArticles(articlePage);
    //   await saveToFile(articles, "articles.json");
    // }
  }
  catch (error) {
    console.error("Scraping error:", error);
  }
  finally {
    await browser?.close();
  }
}
main();
