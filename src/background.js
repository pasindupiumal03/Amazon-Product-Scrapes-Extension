// src/background.js
// Flow: Fetch ASINs → open tab → scrape core → ask content for images (Brand→Manufacturer→Description) → OCR.Space GET → merge & clean → write to Sheets

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

const getCfg = () =>
  new Promise((res) =>
    chrome.storage.local.get(["GAS_ENDPOINT", "AMAZON_DOMAIN", "OCR_API_KEY"], (v) => res(v))
  );

const setBadge = async (text, color = "#000") => {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch {}
};

// --------- Helpers ----------
function extractDomain(input) {
  if (!input) return "amazon.com";
  try {
    if (/^https?:\/\//i.test(input)) {
      const u = new URL(input);
      return (u.hostname || "amazon.com").replace(/^www\./i, "");
    }
    return input.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  } catch {
    return "amazon.com";
  }
}

function extractAsin(s) {
  if (!s) return "";
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /[?&]asin=([A-Z0-9]{10})/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) return m[1].toUpperCase();
  }
  const m = s.match(/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : "";
}

// --------- GAS I/O ----------
async function fetchAsins(GAS_ENDPOINT) {
  const r = await fetch(`${GAS_ENDPOINT}?mode=get_asins`);
  if (!r.ok) throw new Error(`ASIN fetch failed: ${r.status}`);
  const json = await r.json();
  return Array.isArray(json.asins) ? json.asins : [];
}

async function writeRow(GAS_ENDPOINT, payload) {
  const r = await fetch(`${GAS_ENDPOINT}?mode=write_row`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Write failed ${r.status}`);
  return r.json();
}

// --------- Tabs & Messaging ----------
function openAmazonTab(asin, domain) {
  const d = extractDomain(domain || "amazon.com");
  const url = `https://${d}/dp/${encodeURIComponent(asin)}`;
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (tab) => resolve(tab.id));
  });
}

function waitForScrapeFromTab(tabId, asin, timeoutMs = 40000) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ asin, ok: false, error: "timeout" });
    }, timeoutMs);

    const listener = (msg, sender) => {
      if (!msg || sender.tab?.id !== tabId) return;
      if (msg.type === "SCRAPE_RESULT") {
        if (done) return;
        done = true;
        clearTimeout(t);
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ asin, ok: true, data: msg.data });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });
}

function sendMessageWithRetry(tabId, message, retries = 15, delay = 500) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      chrome.tabs.sendMessage(tabId, message, (res) => {
        const err = chrome.runtime.lastError?.message || "";
        if (err && n > 0) {
          setTimeout(() => attempt(n - 1), delay);
        } else {
          resolve(res || null);
        }
      });
    };
    attempt(retries);
  });
}

async function getPriorityOcrImages(tabId) {
  const res = await sendMessageWithRetry(tabId, { type: "GET_OCR_IMAGES" });
  const list = Array.isArray(res?.images) ? res.images : [];
  return list.slice(0, 4);
}

// --------- OCR.Space (GET /parse/imageurl) ----------
function buildOcrGetUrl(apiKey, imageUrl) {
  const params = new URLSearchParams({
    apikey: apiKey,
    url: imageUrl,
    language: "eng",
    isOverlayRequired: "false",
    OCREngine: "2",
    scale: "true",
    isTable: "false",
  });
  return `https://api.ocr.space/parse/imageurl?${params.toString()}`;
}

const SLEEP_BETWEEN_OCR = 900;

async function ocrOneWithRetry(apiKey, imageUrl, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const url = buildOcrGetUrl(apiKey, imageUrl);
      const resp = await fetch(url, { method: "GET" });
      const json = await resp.json();

      if (json?.IsErroredOnProcessing) {
        await SLEEP(1200);
        continue;
      }

      const text = (json?.ParsedResults || [])
        .map((p) => (p?.ParsedText || "").trim())
        .filter(Boolean)
        .join("\n")
        .trim();

      if (text) return text;
    } catch {
      // swallow and retry
    }
    await SLEEP(1200);
  }
  return "";
}

function cleanMergedOcr(text) {
  return (text || "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\s+[|]\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.replace(/\s{2,}/g, " ").trim())
    .filter((l, idx, arr) => l && (idx === 0 || l !== arr[idx - 1]))
    .join("\n");
}

async function ocrSpaceGetMerged(apiKey, imageUrls = []) {
  if (!apiKey || !imageUrls.length) return "";

  const results = [];
  for (const img of imageUrls) {
    const t = await ocrOneWithRetry(apiKey, img, 2);
    if (t) results.push(t);
    await SLEEP(SLEEP_BETWEEN_OCR);
  }

  return cleanMergedOcr(results.join("\n\n"));
}

// --------- Orchestration ----------
async function processOne(asin, cfg) {
  await setBadge("…");
  const tabId = await openAmazonTab(asin, cfg.AMAZON_DOMAIN);

  // Wait for page scrape (title/bullets/description + brand/manufacturer section text)
  const result = await waitForScrapeFromTab(tabId, asin);

  // Ask for OCR images in priority order (Brand→Manufacturer→Description)
  let ocrText = "";
  try {
    const images = await getPriorityOcrImages(tabId); // up to 4
    if (images.length && cfg.OCR_API_KEY) {
      ocrText = await ocrSpaceGetMerged(cfg.OCR_API_KEY, images);
    }
  } catch {}

  // Close the tab
  try { chrome.tabs.remove(tabId); } catch {}

  if (!result.ok || !result.data) {
    return { asin, ok: false, error: result.error || "no_data" };
  }

  const payload = {
    asin,
    title: result.data.title || "",
    bullets: (result.data.bullets || []).join("\n"),
    description: result.data.description || "",
    // IMPORTANT: brand/manufacturer here are now the *section texts* supplied by content.js
    brand: result.data.brand || "",
    manufacturer: result.data.manufacturer || "",
    ocrText: ocrText || "",
  };

  await writeRow(cfg.GAS_ENDPOINT, payload);
  return { asin, ok: true };
}

async function startScrape() {
  const cfg = await getCfg();
  if (!cfg.GAS_ENDPOINT) {
    chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "error", message: "Set GAS endpoint first." });
    return;
  }
  if (!cfg.OCR_API_KEY) {
    chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "error", message: "Set OCR API key in settings." });
    return;
  }

  cfg.AMAZON_DOMAIN = extractDomain(cfg.AMAZON_DOMAIN || "amazon.com");
  chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "started" });

  let raw = [];
  try {
    raw = await fetchAsins(cfg.GAS_ENDPOINT);
  } catch (e) {
    chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "error", message: String(e) });
    return;
  }

  const asins = raw.map((x) => extractAsin(String(x || "").trim())).filter(Boolean);
  if (!asins.length) {
    chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "error", message: "No valid ASINs found in Column A." });
    return;
  }

  let success = 0, failed = 0;
  for (let i = 0; i < asins.length; i++) {
    const asin = asins[i];
    chrome.runtime.sendMessage({ type: "RUN_PROGRESS", index: i + 1, total: asins.length, asin });

    try {
      const r = await processOne(asin, cfg);
      if (r.ok) success++; else failed++;
    } catch {
      failed++;
    }
    await SLEEP(800);
  }

  chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "done", success, failed, total: asins.length });
  await setBadge("");
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "START_SCRAPE") startScrape();
});
