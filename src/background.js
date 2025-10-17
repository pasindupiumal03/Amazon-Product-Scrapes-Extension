let TESSERACT = null; // lazy import if you decide to bundle tesseract.js

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

function uniq(arr) { return Array.from(new Set(arr)); }

function isDecorativeOrTiny(url) {
  if (!url) return true;
  const u = url.toLowerCase();
  if (!/\.(jpg|jpeg|png)$/i.test(u)) return true;
  if (/(sprite|spacer|pixel|favicon|icon|logo|placeholder)/i.test(u)) return true;
  if (/__ac_sr\d{2,3},\d{2,3}__/i.test(u)) return true;
  if (/_sx\d{2,3}_/i.test(u)) return true;
  if (/_ss\d{2,3}_/i.test(u)) return true;
  return false;
}

function buildUrlVariants(u0) {
  // Try multiple forms because Amazon size tokens often produce empty/blocked images
  const variants = [];
  const u = String(u0 || "").trim();
  if (!u) return variants;

  variants.push(u); // original first

  // Strip common size suffixes
  let base = u
    .replace(/_AC_SL\d+_/i, "_AC_SL1500_")
    .replace(/_AC_UL\d+_/i, "_AC_SL1500_")
    .replace(/_AC_SX\d+_/i, "_AC_SL1500_")
    .replace(/_AC_SS\d+_/i, "_AC_SL1500_")
    .replace(/_SX\d+_/i, "_AC_SL1500_")
    .replace(/_SS\d+_/i, "_AC_SL1500_");

  // If dynamic token exists, force a large one
  if (/\._[^.]*\./.test(base)) {
    base = base.replace(/\._[^.]*\./, "._AC_SL1500_.");
  }
  if (!variants.includes(base)) variants.push(base);

  // Also try with tokens completely removed (sometimes works better)
  const stripped = u
    .replace(/(\._[^.]*\.)/g, ".")
    .replace(/_AC_[A-Z]{2}\d+_/gi, "")
    .replace(/_[A-Z]{2}\d+_/gi, "");
  if (!variants.includes(stripped)) variants.push(stripped);

  // Some A+ assets max at ~1464 or ~1200
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
  const res = await sendMessageWithRetry(tabId, { type: "GET_OCR_IMAGES" });
  const list = Array.isArray(res?.images) ? res.images : [];
  const filtered = list.filter((u) => !isDecorativeOrTiny(u));
  return filtered.slice(0, 4);
}

// --------- OCR.Space: GET + POST, param variants, key rotation ----------
function buildOcrGetUrl(key, imageUrl, extraParams = {}) {
  const params = new URLSearchParams({
    apikey: key,
    url: imageUrl,
    language: "eng",
    isOverlayRequired: "false",
    OCREngine: "2",
    scale: "true",
    isTable: "false",
    ...extraParams,
  });
  return `https://api.ocr.space/parse/imageurl?${params.toString()}`;
}

function parseOcrSpaceText(json) {
  if (!json) return "";
  if (json.IsErroredOnProcessing) return "";
  const txt = (json.ParsedResults || [])
    .map((p) => (p?.ParsedText || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return txt || "";
}

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

// GET attempt
async function ocrSpaceGetOnce(key, imageUrl, params, timeoutMs) {
  try {
    const url = buildOcrGetUrl(key, imageUrl, params);
    const resp = await fetchWithTimeout(url, { method: "GET", ms: timeoutMs });
    const json = await resp.json().catch(() => null);
    return parseOcrSpaceText(json);
  } catch {
    return "";
  }
}

// POST attempt (/parse/image) – more permissive server-side
async function ocrSpacePostOnce(key, imageUrl, params, timeoutMs) {
  try {
    const form = new URLSearchParams({
      url: imageUrl,
      language: params?.language || "eng",
      isOverlayRequired: params?.isOverlayRequired || "false",
      OCREngine: params?.OCREngine || "2",
      scale: params?.scale || "true",
      isTable: params?.isTable || "false",
      detectOrientation: params?.detectOrientation || "false",
    });

    const resp = await fetchWithTimeout("https://api.ocr.space/parse/image", {
      method: "POST",
      ms: timeoutMs,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        apikey: key, // header per docs
      },
      body: form,
    });
    const json = await resp.json().catch(() => null);
    return parseOcrSpaceText(json);
  } catch {
    return "";
  }
}

// Param variants fight empty returns
const PARAM_VARIANTS = [
  {}, // default
  { detectOrientation: "true" },
  { OCREngine: "1" },
  { isTable: "true" },
  { language: "auto" },
];

// One image → URL variants × params × key rotation, GET then POST
async function ocrSpaceForImage(keys, imgUrl, fetchTimeoutMs = 12000) {
  const urlVariants = buildUrlVariants(imgUrl);
  for (const variantUrl of urlVariants) {
    for (const params of PARAM_VARIANTS) {
      for (const key of keys) {
        // 1) GET
        let text = await ocrSpaceGetOnce(key, variantUrl, params, fetchTimeoutMs);
        if (text) return text;
        // 2) POST (fallback)
        text = await ocrSpacePostOnce(key, variantUrl, params, fetchTimeoutMs + 3000);
        if (text) return text;
        await SLEEP(120); // tiny backoff between keys
      }
    }
  }
  return "";
}

// Optional: Tesseract fallback (requires bundling tesseract + lang data in extension)
async function tesseractFallback(imgUrl, totalTimeoutMs = 12000) {
  let timeout = null;
  try {
    if (!TESSERACT) {
      TESSERACT = await import(/* webpackChunkName: "tesseract" */ "tesseract.js");
    }
    const { createWorker } = TESSERACT;

    const timed = new Promise(async (resolve) => {
      try {
        const resp = await fetchWithTimeout(imgUrl, { ms: 8000 });
        if (!resp.ok) return resolve("");
        const blob = await resp.blob();

        const worker = await createWorker({ logger: () => {} });
        try {
          await worker.loadLanguage("eng");
          await worker.initialize("eng");
          const { data } = await worker.recognize(blob);
          await worker.terminate();
          const raw = (data && data.text) ? String(data.text) : "";
          resolve(cleanMergedOcr(raw));
        } catch {
          try { await worker.terminate(); } catch {}
          resolve("");
        }
      } catch {
        resolve("");
      }
    });

    const killer = new Promise((resolve) => {
      timeout = setTimeout(() => resolve(""), totalTimeoutMs);
    });

    const out = await Promise.race([timed, killer]);
    return out || "";
  } catch {
    return "";
  } finally {
    if (timeout) clearTimeout(timeout);
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

// Small p-limit with per-task watchdog
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

async function ocrGetMergedWithConcurrency(primaryKey, imageUrls = [], limit = 3) {
  const keys = uniq([
    primaryKey || "",
    "K85105510988957",
    "K84346977888957",
    "K83726935488957",
    "K85995140988957",
  ]).filter(Boolean);

  if (!keys.length || !imageUrls.length) return "";

  const texts = await mapLimit(
    imageUrls,
    limit,
    async (imgUrl) => {
      if (isDecorativeOrTiny(imgUrl)) return "";

      // OCR.Space with: URL variants × param variants × key rotation; GET then POST
      let text = await ocrSpaceForImage(keys, imgUrl, 12000);

      // Absolute last resort: Tesseract (only if bundled + allowed)
      if (!text) {
        text = await tesseractFallback(imgUrl, 12000);
      }
      return text || "";
    },
    20000 // hard cap per image overall
  );

  return cleanMergedOcr(texts.filter(Boolean).join("\n\n"));
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
      if (images.length && cfg.OCR_API_KEY) {
        ocrText = await ocrGetMergedWithConcurrency(cfg.OCR_API_KEY, images, 3);
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
    await SLEEP(400);
  }

  chrome.runtime.sendMessage({ type: "RUN_STATUS", status: "done", success, failed, total: asins.length });
  await setBadge("");
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "START_SCRAPE") startScrape();
});