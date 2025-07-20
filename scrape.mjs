
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

  scraped.push(events.map(({ rawTitle, link, datePublished, dateModified }) => {
    const title = cleanTitle(rawTitle);
    const dateRange = processDates(rawTitle);
    return {
      title,
      link,
      dateRange,
      datePublished: formatDate(datePublished),
      dateModified: formatDate(dateModified),
    };
  }))
  
    console.log(scraped.length, scraped[index - 1].length);
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