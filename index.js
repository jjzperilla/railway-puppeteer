const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cors = require("cors");
const fs = require("fs");

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const PROXY_SERVER = ""; // Example: "http://username:password@proxy.example.com:8080"

// Enhanced stealth configurations
const stealthOptions = {
  languages: ["en-US", "en"],
  vendor: "Google Inc.",
  platform: "Win32",
  webglVendor: "Intel Inc.",
  renderer: "Intel Iris OpenGL Engine",
};

async function scrapeTrackingInfo(trackingNumber, attempt = 1) {
  console.log(`🔄 Attempt ${attempt}: Scraping ${trackingNumber}`);
  
  const url = `https://parcelsapp.com/en/tracking/${trackingNumber}`;
  let browser;

  try {
    // Configure launch options
    const launchOptions = {
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-blink-features=AutomationControlled",
        PROXY_SERVER ? `--proxy-server=${PROXY_SERVER}` : "",
      ].filter(Boolean),
      timeout: 60000,
    };

    browser = await puppeteer.launch(launchOptions);
    console.log("✅ Browser launched");

    const page = await browser.newPage();
    
    // Enhanced stealth setup
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      "X-Forwarded-For": "192.168.1.1" // Fake header
    });
    
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
    );

    // Apply additional stealth evasions
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const blockedResources = ["image", "stylesheet", "font", "media"];
      if (blockedResources.includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log("🌍 Navigating to URL");
    try {
      await page.goto(url, { 
        waitUntil: "networkidle2", 
        timeout: 90000 
      });
    } catch (error) {
      console.log("⚠️ Primary load failed, trying fallback...");
      await page.goto(url, { 
        waitUntil: "domcontentloaded", 
        timeout: 60000 
      });
    }

    // Check for blocking or CAPTCHA
    await checkForBlocking(page, attempt);

    // Wait for content with multiple fallbacks
    try {
      await page.waitForSelector(".event, .parcel-attributes", { 
        timeout: 15000 
      });
    } catch {
      console.log("⚠️ Primary selector not found, trying alternatives...");
      await page.waitForFunction(() => 
        document.querySelector('.event') || 
        document.querySelector('.parcel-attributes') ||
        document.querySelector('.error-message') ||
        document.querySelector('#captcha'),
        { timeout: 10000 }
      );
    }

    // Debugging outputs
    await saveDebugFiles(page, attempt);

    // Extract data with improved error handling
    const trackingEvents = await extractTrackingEvents(page);
    const parcelInfo = await extractParcelInfo(page);

    // Validate results
    if (!trackingEvents.length && attempt < MAX_RETRIES) {
      console.log(`⚠️ No data found. Retrying in ${RETRY_DELAY/1000}s...`);
      await browser.close();
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return scrapeTrackingInfo(trackingNumber, attempt + 1);
    }

    return { 
      tracking_details: trackingEvents, 
      parcel_info: parcelInfo 
    };

  } catch (error) {
    console.error(`❌ Attempt ${attempt} failed:`, error);
    fs.writeFileSync(`error_${attempt}.log`, error.stack);
    
    if (attempt < MAX_RETRIES) {
      console.log(`🔄 Retrying in ${RETRY_DELAY/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return scrapeTrackingInfo(trackingNumber, attempt + 1);
    }
    
    return { 
      error: "Failed to retrieve tracking information",
      details: error.message,
      attempt: attempt
    };
    
  } finally {
    if (browser) {
      await browser.close();
      console.log("🛑 Browser closed");
    }
  }
}

// Helper functions
async function checkForBlocking(page, attempt) {
  const blockingSelectors = [
    '#captcha', 
    '.cloudflare-challenge', 
    '.access-denied',
    '.error-message'
  ];
  
  for (const selector of blockingSelectors) {
    if (await page.$(selector)) {
      const screenshotPath = `blocked_${attempt}.png`;
      await page.screenshot({ path: screenshotPath });
      throw new Error(`Blocked by ${selector}. Screenshot saved to ${screenshotPath}`);
    }
  }
}

async function saveDebugFiles(page, attempt) {
  const debugPrefix = `debug_${attempt}_${Date.now()}`;
  
  // Save screenshot
  await page.screenshot({ 
    path: `${debugPrefix}.png`, 
    fullPage: true 
  });
  
  // Save HTML
  fs.writeFileSync(
    `${debugPrefix}.html`, 
    await page.content()
  );
  
  // Save console logs
  page.on('console', msg => {
    fs.appendFileSync(
      `${debugPrefix}.log`, 
      `${msg.type()}: ${msg.text()}\n`
    );
  });
  
  console.log("✅ Saved debug files:", debugPrefix);
}

async function extractTrackingEvents(page) {
  try {
    return await page.evaluate(() => {
      const events = Array.from(document.querySelectorAll(".event")).map(event => {
        const timeElement = event.querySelector(".event-time");
        const date = timeElement?.querySelector("strong")?.innerText.trim() || "N/A";
        const time = timeElement?.querySelector("span")?.innerText.trim() || "N/A";
        
        return {
          date,
          time,
          status: event.querySelector(".event-content strong")?.innerText.trim() || "N/A",
          courier: event.querySelector(".carrier")?.innerText.trim() || "N/A",
        };
      });
      
      return events.length ? events : [{ 
        date: "N/A", 
        time: "N/A", 
        status: "No tracking events found", 
        courier: "N/A" 
      }];
    });
  } catch (error) {
    console.log("⚠️ Failed to extract events:", error);
    return [];
  }
}

async function extractParcelInfo(page) {
  try {
    return await page.evaluate(() => {
      const getText = (selector, parent = document) => 
        parent.querySelector(selector)?.innerText.trim().replace(/\s+/g, ' ') || "N/A";
      
      const attributes = document.querySelector(".parcel-attributes");
      
      return {
        tracking_number: getText("tr:nth-child(1) .value span", attributes),
        origin: getText("tr:nth-child(2) .value span:nth-child(2)", attributes),
        destination: getText("tr:nth-child(3) .value span:nth-child(2)", attributes),
        courier: getText("tr:nth-child(4) .value a", attributes),
        days_in_transit: getText("tr:nth-child(6) .value span", attributes),
        tracking_link: getText(".tracking-link input", attributes),
      };
    });
  } catch (error) {
    console.log("⚠️ Failed to extract parcel info:", error);
    return {
      tracking_number: "N/A",
      origin: "N/A",
      destination: "N/A",
      courier: "N/A",
      days_in_transit: "N/A",
      tracking_link: "N/A"
    };
  }
}

// API Endpoint
app.get("/api/track", async (req, res) => {
  const trackingNumber = req.query.num;
  
  if (!trackingNumber) {
    return res.status(400).json({ 
      error: "Tracking number is required",
      example: "/api/track?num=WNBAA0341685466YQ" 
    });
  }

  console.log(`📦 Tracking request for: ${trackingNumber}`);
  const result = await scrapeTrackingInfo(trackingNumber);
  
  if (result.error) {
    res.status(500).json(result);
  } else {
    res.json(result);
  }
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Try: http://localhost:${PORT}/api/track?num=WNBAA0341685466YQ`);
});