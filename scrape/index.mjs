import { launch } from "puppeteer";
import { cfCheck, preload } from "./cloudflare.mjs";

const IS_PRODUCTION_BUILD = process.env.NODE_ENV === "production";
export const userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36";
export let browser = null;

export async function scrape(url) {
    try {
        browser ||= await launch({
            ignoreDefaultArgs: ["--enable-automation"],
            args: [
                ...(IS_PRODUCTION_BUILD
                    ? ["--disable-blink-features=AutomationControlled", "--disable-features=site-per-process", "-disable-site-isolation-trials"]
                    : ["--disable-blink-features=AutomationControlled"]),
                ...["--no-sandbox", "--disable-setuid-sandbox"],
            ],
            defaultViewport: { width: 1920, height: 1080 },
            headless: true,
        });
        const pages = await browser.pages();
        const page = pages[0];
        await page.setUserAgent(userAgent);
        await page.setViewport({ width: 1920, height: 1080 });
        await page.evaluateOnNewDocument(preload);
        await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 60000,
        });
        await cfCheck(page);
        return page;
    }
    catch (error) {
        throw error;
    }
}
