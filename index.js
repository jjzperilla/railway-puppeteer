const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const RecaptchaPlugin = require("puppeteer-extra-plugin-recaptcha");
const cors = require("cors");

puppeteer.use(StealthPlugin());
puppeteer.use(
    RecaptchaPlugin({
        visualFeedback: true, // Shows a visual hint when a captcha is detected
    })
);

const app = express();
app.use(cors());

const MAX_RETRIES = 3; // Retry limit

async function scrapeTracking(trackingNumber, attempt = 1) {
    const url = `https://parcelsapp.com/en/tracking/${trackingNumber}`;
    let browser;

    try {
        console.log(`[Attempt ${attempt}] Scraping tracking number:`, trackingNumber);

     browser = await puppeteer.launch({
    headless: true, // Use true instead of "new" for better compatibility
    args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-software-rasterizer",
        "--disable-features=site-per-process",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-default-apps",
        "--no-first-run"
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined // Required for Railway
});

        console.log("✅ Chromium launched successfully");

        const page = await browser.newPage();

        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        );

        await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

        // 🚀 Anti-Bot Detection Bypass
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => false });
        });

        // Block unnecessary resources
        await page.setRequestInterception(true);
        page.on("request", (request) => {
            if (["image", "stylesheet", "font"].includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        console.log("🌍 Navigating to:", url);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

        // ✅ Solve CAPTCHA if needed
        await page.solveRecaptchas();

        // 🔄 Wait for tracking data to load
        await page.waitForSelector(".event", { timeout: 60000 }).catch(() => {
            console.log("⚠️ Tracking data not found, waiting longer...");
        });

        console.log("✅ Page loaded, scraping data...");

        const trackingEvents = await page.evaluate(() => {
            return Array.from(document.querySelectorAll(".event")).map(event => ({
                date: event.querySelector(".event-time strong")?.innerText.trim() || "N/A",
                time: event.querySelector(".event-time span")?.innerText.trim() || "N/A",
                status: event.querySelector(".event-content strong")?.innerText.trim() || "N/A",
                courier: event.querySelector(".carrier")?.innerText.trim() || "N/A"
            }));
        });

        const parcelInfo = await page.evaluate(() => {
            const getText = (selector) => document.querySelector(selector)?.innerText.trim() || "N/A";

            return {
                tracking_number: getText(".parcel-attributes tr:nth-child(1) .value span"),
                origin: getText(".parcel-attributes tr:nth-child(2) .value span:nth-child(2)"),
                destination: getText(".parcel-attributes tr:nth-child(3) .value span:nth-child(2)"),
                courier: getText(".parcel-attributes tr:nth-child(4) .value a"),
                days_in_transit: getText(".parcel-attributes tr:nth-child(6) .value span"),
                tracking_link: getText(".tracking-link input")
            };
        });

        if (!trackingEvents.length) {
            console.log(`⚠️ No tracking data found on attempt ${attempt}`);
            if (attempt < MAX_RETRIES) {
                console.log(`🔄 Retrying... (Attempt ${attempt + 1})`);
                await browser.close();
                return scrapeTracking(trackingNumber, attempt + 1);
            } else {
                return { error: "Tracking information not found." };
            }
        }

        console.log("✅ Scraping completed successfully.");
        return { tracking_details: trackingEvents, parcel_info: parcelInfo };

    } catch (error) {
        console.error("❌ Scraping error:", error);
        return { error: error.message };
    } finally {
        if (browser) {
            console.log("🛑 Closing the browser.");
            await browser.close();
        }
    }
}

// 🚀 API Route
app.get("/api/track", async (req, res) => {
    const trackingNumber = req.query.num;
    if (!trackingNumber) {
        return res.status(400).json({ error: "Tracking number is required" });
    }

    const result = await scrapeTracking(trackingNumber);
    res.json(result);
});

// 🚀 Start Express Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
