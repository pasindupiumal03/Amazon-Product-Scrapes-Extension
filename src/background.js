const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

const getCfg = () =>
  new Promise((res) =>
    chrome.storage.local.get(["GAS_ENDPOINT", "AMAZON_DOMAIN"], (v) => res(v))
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

function uniq(arr) { return Array.from(new Set(arr)); }

function isDecorativeOrTiny(url) {
  if (!url) return true;
  const u = url.toLowerCase();
  if (!/\.(jpg|jpeg|png)$/i.test(u)) return true;
  if (/(sprite|spacer|pixel|favicon|icon|logo|placeholder|transparent)/i.test(u)) return true;
  if (/__ac_sr\d{2,3},\d{2,3}__/i.test(u)) return true;
  if (/_sx\d{2,3}_/i.test(u)) return true;
  if (/_ss\d{2,3}_/i.test(u)) return true;
  return false;
}

function buildUrlVariants(u0) {
  const variants = [];
  const u = String(u0 || "").trim();
  if (!u) return variants;

  variants.push(u); // original

  let base = u
    .replace(/_AC_SL\d+_/i, "_AC_SL1500_")
    .replace(/_AC_UL\d+_/i, "_AC_SL1500_")
    .replace(/_AC_SX\d+_/i, "_AC_SL1500_")
    .replace(/_AC_SS\d+_/i, "_AC_SL1500_")
    .replace(/_SX\d+_/i, "_AC_SL1500_")
    .replace(/_SS\d+_/i, "_AC_SL1500_");

  if (/\._[^.]*\./.test(base)) {
    base = base.replace(/\._[^.]*\./, "._AC_SL1500_.");
  }
  if (!variants.includes(base)) variants.push(base);

  const stripped = u
    .replace(/(\._[^.]*\.)/g, ".")
    .replace(/_AC_[A-Z]{2}\d+_/gi, "")
    .replace(/_[A-Z]{2}\d+_/gi, "");
  if (!variants.includes(stripped)) variants.push(stripped);

  const alt1500 = base.replace(/_AC_SL1500_/i, "_AC_SL1464_");
  if (!variants.includes(alt1500)) variants.push(alt1500);
  const alt1200 = base.replace(/_AC_SL1500_/i, "_AC_SL1200_");
  if (!variants.includes(alt1200)) variants.push(alt1200);

  return uniq(variants);
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

function waitForScrapeFromTab(tabId, asin, timeoutMs = 45000) {
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

function sendMessageWithRetry(tabId, message, retries = 18, delay = 450) {
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
  console.log(`=== Getting OCR images for tab ${tabId} ===`);
  const res = await sendMessageWithRetry(tabId, { type: "GET_OCR_IMAGES" });
  const list = Array.isArray(res?.images) ? res.images : [];
  console.log(`Raw images received from content script: ${list.length}`, list);
  
  const filtered = list.filter((u) => !isDecorativeOrTiny(u));
  console.log(`After filtering decorative images: ${filtered.length}`, filtered);
  
  const final = filtered.slice(0, 4);
  console.log(`Final OCR images to process: ${final.length}`, final);
  
  return final;
}

// --------- Small utils ----------
async function fetchWithTimeout(url, { method = "GET", ms = 12000, headers, body } = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
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

async function mapLimit(items, limit, mapper, perTaskTimeoutMs = 18000) {
  const out = new Array(items.length);
  let i = 0, active = 0;

  function runOne(idx) {
    const p = Promise.resolve().then(() => mapper(items[idx], idx));
    const timed = new Promise((resolve) => {
      const id = setTimeout(() => resolve(""), perTaskTimeoutMs);
      p.then((v) => resolve(v)).catch(() => resolve("")).finally(() => clearTimeout(id));
    });
    return timed;
  }

  return await new Promise((resolve) => {
    const next = () => {
      if (i >= items.length && active === 0) return resolve(out);
      while (active < limit && i < items.length) {
        const idx = i++;
        active++;
        runOne(idx)
          .then((val) => { out[idx] = val || ""; })
          .finally(() => { active--; next(); });
      }
    };
    next();
  });
}

// --------- Fiverr API OCR ----------
async function extractTextFromFiverrAPI(imageUrl, timeoutMs = 12000) {
  try {
    const resp = await fetchWithTimeout("https://fiverr-dj8148-server.vercel.app/extract-text", {
      method: "POST",
      ms: timeoutMs,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl })
    });

    if (!resp.ok) {
      console.log(`Fiverr API failed for ${imageUrl}: ${resp.status}`);
      return "";
    }

    const json = await resp.json().catch(() => null);
    return (json?.text || "").trim();
  } catch (e) {
    console.log(`Fiverr API error for ${imageUrl}:`, e);
    return "";
  }
}

async function fiverrApiForImage(imgUrl, fetchTimeoutMs = 12000) {
  const variants = buildUrlVariants(imgUrl);
  for (const v of variants) {
    const txt = await extractTextFromFiverrAPI(v, fetchTimeoutMs);
    if (txt) return txt;
  }
  return "";
}

// --------- Fiverr API Only OCR ----------
async function ocrGetMergedWithConcurrency(imageUrls = [], limit = 3) {
  console.log(`=== Starting OCR processing ===`);
  console.log(`Processing ${imageUrls.length} images with concurrency limit ${limit}`);
  
  if (!imageUrls.length) {
    console.log("No images to process for OCR");
    return "";
  }

  const texts = await mapLimit(
    imageUrls,
    limit,
    async (imgUrl, index) => {
      console.log(`=== Processing image ${index + 1}/${imageUrls.length}: ${imgUrl} ===`);
      
      if (isDecorativeOrTiny(imgUrl)) {
        console.log(`Skipping decorative/tiny image: ${imgUrl}`);
        return "";
      }

      // Fiverr API OCR
      console.log(`Sending to Fiverr API: ${imgUrl}`);
      const text = await fiverrApiForImage(imgUrl, 12000);
      console.log(`OCR result for ${imgUrl}:`, text ? `"${text.substring(0, 100)}..."` : "No text extracted");
      return text || "";
    },
    20000
  );

  const validTexts = texts.filter(Boolean);
  console.log(`=== OCR Summary ===`);
  console.log(`Total images processed: ${imageUrls.length}`);
  console.log(`Images with extracted text: ${validTexts.length}`);
  console.log(`Total characters extracted: ${validTexts.join("").length}`);
  
  const mergedText = cleanMergedOcr(validTexts.join("\n\n"));
  console.log(`Final merged OCR text length: ${mergedText.length}`);
  
  return mergedText;
}

// --------- Orchestration ----------
async function processOne(asin, cfg) {
  await setBadge("…");
  const tabId = await openAmazonTab(asin, cfg.AMAZON_DOMAIN);

  const ASIN_TIMEOUT_MS = 90000;
  const guard = new Promise((resolve) =>
    setTimeout(() => resolve({ asin, ok: false, error: "asin_watchdog_timeout" }), ASIN_TIMEOUT_MS)
  );

  const run = (async () => {
    const result = await waitForScrapeFromTab(tabId, asin);

    let ocrText = "";
    try {
      const images = await getPriorityOcrImages(tabId); // up to 4; already filtered
      if (images.length) {
        ocrText = await ocrGetMergedWithConcurrency(images, 3);
      }
    } catch {
      // keep empty
    }

    try { chrome.tabs.remove(tabId); } catch {}

    if (!result.ok || !result.data) {
      return { asin, ok: false, error: result.error || "no_data" };
    }

    const payload = {
      asin,
      title: result.data.title || "",
      bullets: (result.data.bullets || []).join("\n"),
      description: result.data.description || "",
      brand: result.data.brand || "",
      manufacturer: result.data.manufacturer || "",
      ocrText: ocrText || "",
    };

    try {
      await writeRow(cfg.GAS_ENDPOINT, payload);
    } catch (e) {
      return { asin, ok: false, error: String(e) };
    }
    return { asin, ok: true };
  })();

  const result = await Promise.race([run, guard]);

  try { chrome.tabs.remove(tabId); } catch {}

  return result;
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
    await SLEEP(400);
  }

  chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "done", success, failed, total: asins.length });
  await setBadge("");
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "START_SCRAPE") startScrape();
});