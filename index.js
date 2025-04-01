const express = require("express");
const { chromium } = require("playwright");
const cors = require("cors");
const fs = require("fs");

const app = express();
app.use(cors());

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

async function applyStealth(context) {
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await context.addInitScript(() => {
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
            parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : originalQuery(parameters);
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });
}

async function scrapeTrackingInfo(trackingNumber, attempt = 1) {
    console.log(`\n📦 Attempt ${attempt}: Scraping tracking number: ${trackingNumber}`);
    const url = `https://parcelsapp.com/en/tracking/${trackingNumber}`;
    let browser;

    try {
        browser = await chromium.launch({ headless: true });
        console.log("✅ Chromium launched successfully");

        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
            extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
        });

        // Block unnecessary resources like images and styles
        await context.route("**/*.{png,jpg,jpeg,css,svg}", (route) => route.abort());

        const page = await context.newPage();
        await applyStealth(page);

        console.log("🌍 Navigating to:", url);

        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
            console.log("✅ Page loaded.");
        } catch (error) {
            console.log("⚠️ Page loading failed, retrying...");
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        }

        // Wait for elements to be visible (increased timeout)
        await page.waitForSelector(".event, .parcel-attributes", { visible: true, timeout: 30000 });

        const trackingEvents = await page.evaluate(() => {
            return Array.from(document.querySelectorAll(".event")).map(event => ({
                date: event.querySelector(".event-time strong")?.innerText.trim() || "N/A",
                time: event.querySelector(".event-time span")?.innerText.trim() || "N/A",
                status: event.querySelector(".event-content strong")?.innerText.trim() || "N/A",
                courier: event.querySelector(".carrier")?.innerText.trim() || "N/A",
            })).filter(event => event.date !== "N/A");
        });

        const parcelInfo = await page.evaluate(() => {
            const getText = (selector) => document.querySelector(selector)?.innerText.trim() || "N/A";
            return {
                tracking_number: getText(".parcel-attributes tr:nth-child(1) .value span"),
                origin: getText(".parcel-attributes tr:nth-child(2) .value span:nth-child(2)"),
                destination: getText(".parcel-attributes tr:nth-child(3) .value span:nth-child(2)"),
                courier: getText(".parcel-attributes tr:nth-child(4) .value a"),
                days_in_transit: getText(".parcel-attributes tr:nth-child(6) .value span"),
                tracking_link: getText(".tracking-link input"),
            };
        });

        console.log("✅ Scraped data:", trackingEvents, parcelInfo);

        if (!trackingEvents.length && attempt < MAX_RETRIES) {
            console.log(`🔄 No tracking data found. Retrying in ${RETRY_DELAY / 1000} seconds...`);
            await browser.close();
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
            return scrapeTrackingInfo(trackingNumber, attempt + 1);
        }

        return { tracking_details: trackingEvents, parcel_info: parcelInfo };
    } catch (error) {
        console.error(`❌ Error on attempt ${attempt}:`, error);
        fs.writeFileSync("error_log.txt", error.toString(), "utf-8");

        if (attempt < MAX_RETRIES) {
            console.log(`🔄 Retrying attempt ${attempt + 1} in ${RETRY_DELAY / 1000} seconds...`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
            return scrapeTrackingInfo(trackingNumber, attempt + 1);
        }

        return { error: error.message };
    } finally {
        if (browser) {
            console.log("🛑 Closing the browser.");
            await browser.close();
        }
    }
}



app.get("/api/track", async (req, res) => {
    const trackingNumber = req.query.num;
    if (!trackingNumber) {
        return res.status(400).json({ error: "Tracking number is required" });
    }
    const result = await scrapeTrackingInfo(trackingNumber);
    res.json(result);
});

app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});