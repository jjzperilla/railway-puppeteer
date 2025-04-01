const express = require("express");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth")();
const cors = require("cors");

// Apply stealth plugin
chromium.use(StealthPlugin);

const app = express();
app.use(cors());

// Configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 10000;
const PAGE_LOAD_TIMEOUT = 60000;
const BROWSER_LAUNCH_TIMEOUT = 120000;

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
];

const SELECTOR_CONFIGS = [
    {
        events: ".event",
        time: ".event-time strong",
        status: ".event-content strong",
        courier: ".carrier",
        attributes: ".parcel-attributes"
    }
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function createBrowserInstance() {
    return await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        timeout: BROWSER_LAUNCH_TIMEOUT
    });
}

async function extractWithConfig(page, config) {
    try {
        await page.waitForSelector(config.events, { timeout: 10000 });
        if (page.isClosed()) throw new Error("Page closed before extraction");
        
        const trackingEvents = await page.evaluate(cfg => {
            return Array.from(document.querySelectorAll(cfg.events)).map(event => ({
                date: event.querySelector(cfg.time)?.textContent.trim() || "N/A",
                status: event.querySelector(cfg.status)?.textContent.trim() || "N/A",
                courier: event.querySelector(cfg.courier)?.textContent.trim() || "N/A"
            }));
        }, config);
        
        return trackingEvents.length > 0 ? { trackingEvents } : null;
    } catch (error) {
        console.warn(`⚠️ Selector config failed: ${error.message}`);
    }
    return null;
}

async function scrapeWithRetry(trackingNumber) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let browser, context, page;
        try {
            console.log(`📦 Attempt ${attempt}: Scraping ${trackingNumber}`);
            browser = await createBrowserInstance();
            context = await browser.newContext({ userAgent: getRandomUserAgent() });
            page = await context.newPage();

            page.on('close', () => console.log('⚠️ Page closed unexpectedly!'));
            console.log("🌍 Navigating to tracking page");
            await page.goto(`https://parcelsapp.com/en/tracking/${trackingNumber}`, {
                waitUntil: "domcontentloaded",
                timeout: PAGE_LOAD_TIMEOUT
            });

            if (page.isClosed()) throw new Error("Page closed before extraction");

            for (const config of SELECTOR_CONFIGS) {
                const result = await extractWithConfig(page, config);
                if (result) {
                    console.log("✅ Data extracted successfully");
                    return { tracking_details: result.trackingEvents, status: "success", attempts: attempt };
                }
            }
            throw new Error("All selector configurations failed");
        } catch (error) {
            console.error(`❌ Attempt ${attempt} failed:`, error.message);
            lastError = error;
            if (attempt < MAX_RETRIES) await new Promise(res => setTimeout(res, RETRY_DELAY));
        } finally {
            try { if (page) await page.close(); } catch (e) {}
            try { if (context) await context.close(); } catch (e) {}
            try { if (browser) await browser.close(); } catch (e) {}
        }
    }
    return { error: "Failed after all attempts", details: lastError?.message || "Unknown error", status: "error", attempts: MAX_RETRIES };
}

app.get("/api/track", async (req, res) => {
    try {
        const trackingNumber = req.query.num;
        if (!trackingNumber) return res.status(400).json({ error: "Tracking number required", status: "bad_request" });
        const result = await scrapeWithRetry(trackingNumber);
        res.json(result);
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Internal server error", status: "server_error" });
    }
});

app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
