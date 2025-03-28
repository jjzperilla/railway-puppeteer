const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cors = require("cors");
const fs = require("fs");

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());

const MAX_RETRIES = 3;  // 🔄 Maximum retry attempts
const RETRY_DELAY = 5000; // ⏳ 5 seconds delay before retrying

// ✅ Optional Proxy (Replace with a real proxy)
const PROXY_SERVER = ""; // Example: "http://proxy.example.com:8080"

async function scrapeTrackingInfo(trackingNumber, attempt = 1) {
    console.log(`🔄 Attempt ${attempt}: Scraping tracking number: ${trackingNumber}`);

    const url = `https://parcelsapp.com/en/tracking/${trackingNumber}`;
    let browser;

    try {
        // 🏁 Launch Puppeteer
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                PROXY_SERVER ? `--proxy-server=${PROXY_SERVER}` : "", // ✅ Proxy Support
            ].filter(Boolean), // Removes empty args
            timeout: 60000, // ⏳ Reduce timeout to 60s
        });

        console.log("✅ Chromium launched successfully");

        const page = await browser.newPage();
        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
        );
        await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

        // 🚫 Block unnecessary resources
        await page.setRequestInterception(true);
        page.on("request", (req) => {
            if (["image", "stylesheet", "font"].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log("🌍 Navigating to:", url);

        // 🔄 Load the page with error handling
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
            console.log("✅ DOM content loaded.");
        } catch (error) {
            console.log("⚠️ DOM content loading failed, retrying with full load...");
            await page.goto(url, { waitUntil: "load", timeout: 90000 });
        }

        // ⏳ Wait for tracking details
        await page.waitForSelector(".event, .parcel-attributes", { timeout: 60000 }).catch(() => {
            console.log("⚠️ Tracking details not found yet...");
        });

        // 📸 Debugging: Screenshot & HTML save (Railway)
        await page.screenshot({ path: `railway_debug_${attempt}.png`, fullPage: true });
        fs.writeFileSync(`railway_debug_${attempt}.html`, await page.content());
        console.log("✅ Saved Railway page for debugging.");

        // 📦 Extract tracking events
        const trackingEvents = await page.evaluate(() => {
            return Array.from(document.querySelectorAll(".event")).map(event => ({
                date: event.querySelector(".event-time strong")?.innerText.trim() || "N/A",
                time: event.querySelector(".event-time span")?.innerText.trim() || "N/A",
                status: event.querySelector(".event-content strong")?.innerText.trim() || "N/A",
                courier: event.querySelector(".carrier")?.innerText.trim() || "N/A",
            }));
        });

        // 📜 Extract parcel information
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

        // 🔄 Retry if no data found
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

        // 🔄 Retry on failure
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

// 📡 API Endpoint
app.get("/api/track", async (req, res) => {
    const trackingNumber = req.query.num;
    if (!trackingNumber) {
        return res.status(400).json({ error: "Tracking number is required" });
    }

    const result = await scrapeTrackingInfo(trackingNumber);
    res.json(result);
});

// 🚀 Start Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
