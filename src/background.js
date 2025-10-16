// Background orchestrator: fetch NEW ASINs -> open tabs -> scrape -> OCR -> write to Sheets

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

const getCfg = () =>
  new Promise((res) =>
    chrome.storage.local.get(["GAS_ENDPOINT", "VISION_API_KEY", "AMAZON_DOMAIN"], (v) => res(v))
  );

const setBadge = async (text, color = "#000") => {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch (_) {}
};

// --- Helpers ---
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

// Extract 10-char ASINs from either plain ASIN or URLs
function extractAsin(s) {
  if (!s) return "";
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /[?&]asin=([A-Z0-9]{10})/i
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) return m[1].toUpperCase();
  }
  const m = s.match(/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : "";
}

// ---- Google Apps Script I/O ----

// ✅ Only fetch NEW (unprocessed) ASINs
async function fetchNewAsins(GAS_ENDPOINT) {
  const url = `${GAS_ENDPOINT}?mode=get_new_asins`;
  const r = await fetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`ASIN fetch failed: ${r.status}`);
  const json = await r.json();
  return Array.isArray(json.asins) ? json.asins : [];
}

// (kept for completeness; not used now)
// async function fetchAsins(GAS_ENDPOINT) { ... }

async function writeRow(GAS_ENDPOINT, payload) {
  const r = await fetch(`${GAS_ENDPOINT}?mode=write_row`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Write failed ${r.status}`);
  return r.json();
}

// ---- OCR with Google Vision (optional) ----
async function ocrWithVision(visionKey, imageUrls = []) {
  if (!visionKey || !imageUrls.length) return "";
  const topN = imageUrls.slice(0, 3);
  let ocrTexts = [];

  for (const url of topN) {
    try {
      const b = await fetch(url);
      const blob = await b.blob();
      const buff = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buff)));

      const body = {
        requests: [
          {
            image: { content: base64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }]
          }
        ]
      };

      const resp = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(visionKey)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );

      const json = await resp.json();
      const text = json?.responses?.[0]?.fullTextAnnotation?.text || "";
      if (text) ocrTexts.push(text.trim());
      await SLEEP(400);
    } catch {
      // skip this image on error
    }
  }

  return ocrTexts.join("\n\n").trim();
}

// ---- Tab + Scrape coordination ----
function openAmazonTab(asin, domain) {
  const d = extractDomain(domain || "amazon.com");
  const url = `https://${d}/dp/${encodeURIComponent(asin)}`;
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (tab) => resolve(tab.id));
  });
}

function waitForScrapeFromTab(tabId, asin, timeoutMs = 35000) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ asin, ok: false, error: "timeout" });
      try { chrome.tabs.remove(tabId); } catch (_) {}
    }, timeoutMs);

    const listener = (msg, sender) => {
      if (!msg || sender.tab?.id !== tabId) return;
      if (msg.type === "SCRAPE_RESULT") {
        if (done) return;
        done = true;
        clearTimeout(t);
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ asin, ok: true, data: msg.data });
        try { chrome.tabs.remove(tabId); } catch (_) {}
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function processOne(asin, cfg) {
  await setBadge("…");
  const tabId = await openAmazonTab(asin, cfg.AMAZON_DOMAIN);
  const result = await waitForScrapeFromTab(tabId, asin);

  if (!result.ok || !result.data) {
    return { asin, ok: false, error: result.error || "no_data" };
  }

  let ocrText = "";
  try {
    ocrText = await ocrWithVision(cfg.VISION_API_KEY, result.data.imageUrls || []);
  } catch {}

  const payload = {
    asin,
    title: result.data.title || "",
    bullets: (result.data.bullets || []).join("\n"),
    description: result.data.description || "",
    brand: result.data.brand || "",
    manufacturer: result.data.manufacturer || "",
    brandInfo: result.data.brandInfo || "",
    manufacturerInfo: result.data.manufacturerInfo || "",
    ocrText
  };

  // ✅ This write marks the ASIN as processed on the server side
  await writeRow(cfg.GAS_ENDPOINT, payload);
  return { asin, ok: true };
}

async function startScrape() {
  const cfg = await getCfg();
  if (!cfg.GAS_ENDPOINT) {
    chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "error", message: "Set GAS endpoint first." });
    return;
  }
  cfg.AMAZON_DOMAIN = extractDomain(cfg.AMAZON_DOMAIN || "amazon.com");

  chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "started" });

  let raw = [];
  try {
    // ✅ only get NEW (unprocessed) ASINs
    raw = await fetchNewAsins(cfg.GAS_ENDPOINT);
  } catch (e) {
    chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "error", message: String(e) });
    return;
  }

  const asins = raw.map((x) => extractAsin(String(x || "").trim())).filter(Boolean);

  if (asins.length === 0) {
    chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "info", message: "No new ASINs to process." });
    await setBadge("");
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
