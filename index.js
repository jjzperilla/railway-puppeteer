const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cors = require("cors");
const fs = require("fs");

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());

const MAX_RETRIES = 3; // Maximum retry attempts
const RETRY_DELAY = 5000; // 5 seconds delay before retrying

const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
];

async function scrapeTrackingInfo(trackingNumber, attempt = 1) {
    console.log(`🔄 Attempt ${attempt}: Scraping tracking number: ${trackingNumber}`);

    const url = `https://parcelsapp.com/en/tracking/${trackingNumber}`;
    let browser;

    try {
        // ✅ Launch Puppeteer with Railway-compatible settings
        browser = await puppeteer.launch({
            headless: true, // "new" can cause issues on Railway
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, // Required for Railway
            timeout: 180000,
        });

        console.log("✅ Chromium launched successfully");

        const page = await browser.newPage();
        await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);
        await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

        // ✅ Block unnecessary resources to speed up scraping
        await page.setRequestInterception(true);
        page.on("request", (request) => {
            if (["image", "stylesheet", "font"].includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        console.log("🌍 Navigating to:", url);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 180000 });

        // ✅ Extra wait time to ensure content loads
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log("✅ Page loaded, scraping data...");

        // ✅ Debugging: Save page content for Railway troubleshooting
        const htmlContent = await page.content();
        fs.writeFileSync("debug.html", htmlContent);
        console.log("📝 Saved page content to debug.html");

        // ✅ Extract tracking events
        const trackingEvents = await page.evaluate(() => {
            return Array.from(document.querySelectorAll(".event")).map(event => ({
                date: event.querySelector(".event-time strong")?.innerText.trim() || "N/A",
                time: event.querySelector(".event-time span")?.innerText.trim() || "N/A",
                status: event.querySelector(".event-content strong")?.innerText.trim() || "N/A",
                courier: event.querySelector(".carrier")?.innerText.trim() || "N/A"
            }));
        });

        // ✅ Extract parcel information
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

        // If no tracking events found, retry
        if (!trackingEvents.length && attempt < MAX_RETRIES) {
            console.log(`⚠️ No tracking data found. Retrying in ${RETRY_DELAY / 1000} seconds...`);
            await browser.close();
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
            return scrapeTrackingInfo(trackingNumber, attempt + 1);
        }

        return { tracking_details: trackingEvents, parcel_info: parcelInfo };

    } catch (error) {
        console.error(`❌ Error on attempt ${attempt}:`, error);
        fs.writeFileSync("error_log.txt", error.toString(), "utf-8");

        // Retry on failure
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

// 🚀 API endpoint
app.get("/api/track", async (req, res) => {
    const trackingNumber = req.query.num;
    if (!trackingNumber) {
        return res.status(400).json({ error: "Tracking number is required" });
    }

    const result = await scrapeTrackingInfo(trackingNumber);
    res.json(result);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
