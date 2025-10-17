// src/content.js
(() => {
  // Only run on Amazon
  try {
    const h = location.hostname || "";
    if (!/amazon\./i.test(h)) return;
  } catch {
    return;
  }

  const txt = (el) => (el?.textContent || "").trim();
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------------- Image helpers (used by background for OCR) ----------------
  function normalizeImgUrl(src) {
    if (!src) return "";
    let out = src.trim();
    if (!out) return "";
    if (out.startsWith("//")) out = "https:" + out;

    // Remove common Amazon sizing tokens so we prefer higher res
    out = out
      .replace(/_SX\d+_.*/i, "")
      .replace(/_SS\d+_.*/i, "")
      .replace(/_AC_SL\d+_.*/i, "")
      .replace(/_AC_UL\d+_.*/i, "")
      .replace(/_AC_SX\d+_.*/i, "")
      .replace(/_AC_SS\d+_.*/i, "");

    // If dynamic token exists, jump to a big one
    if (/\._[^.]*\./.test(out)) {
      out = out.replace(/\._[^.]*\./, "._AC_SL1500_.");
    }
    return out;
  }

  function isValidOcrImage(url, alt = "") {
    if (!url) return false;
    if (!/\.(jpg|jpeg|png)$/i.test(url)) return false;

    const hay = (url + " " + (alt || "")).toLowerCase();
    const bad = [
      "sprite", "spacer", "pixel", "favicon", "icon", "logo",
      "transparent", "placeholder"
    ];
    if (bad.some(k => hay.includes(k))) return false;

    // Skip known tiny grid thumbs
    if (/__AC_SR\d{2,3},\d{2,3}__/.test(url)) return false;
    if (/_SX\d{2,3}_/.test(url)) return false;

    return true;
  }

  function collectImgUrlsFromRoot(root) {
    const urls = new Set();

    // <img> tags
    qa("img", root).forEach((img) => {
      const alt = img.getAttribute("alt") || "";
      let src =
        img.getAttribute("data-src") ||
        img.getAttribute("data-old-hires") ||
        img.getAttribute("src") || "";
      src = normalizeImgUrl(src);
      if (isValidOcrImage(src, alt)) urls.add(src);
    });

    // CSS background-image (often in Brand Story)
    qa("[style*='background-image']", root).forEach((node) => {
      const style = node.getAttribute("style") || "";
      const m = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
      if (m && m[2]) {
        const src = normalizeImgUrl(m[2]);
        if (isValidOcrImage(src)) urls.add(src);
      }
    });

    // data-a-dynamic-image JSON (rare here, but cheap to check)
    qa("[data-a-dynamic-image]", root).forEach((node) => {
      try {
        const json = node.getAttribute("data-a-dynamic-image");
        const obj = JSON.parse(json);
        Object.keys(obj || {}).forEach((u) => {
          const src = normalizeImgUrl(u);
          if (isValidOcrImage(src)) urls.add(src);
        });
      } catch {}
    });

    return Array.from(urls);
  }

  // ---------------- Section finders ----------------
  function closestBlockForHeading(hEl) {
    return (
      hEl.closest(".aplus-module") ||
      hEl.closest(".aplus-v2") ||
      hEl.closest("#aplus_feature_div") ||
      hEl.closest("div") ||
      document
    );
  }

  function findHeadingSections(regex) {
    const found = new Set();
    qa("h2, h3").forEach((h) => {
      const t = txt(h);
      if (regex.test(t)) {
        const block = closestBlockForHeading(h);
        if (block) found.add(block);
      }
    });
    return Array.from(found);
  }

  function brandSections() {
    const blocks = new Set();

    // Headings first
    findHeadingSections(/^\s*from\s+the\s+brand\s*$/i).forEach((b) => blocks.add(b));

    // Known Brand Story selectors
    [
      "#aplusBrandStory_feature_div",
      "[data-feature-name='aplusBrandStory']",
      "[data-module-name='aplusBrandStory']",
      ".apm-brand-story-hero",
      ".apm-brand-story-card",
      ".apm-brand-story-carousel",
      ".aplus-brand-story-hero",
    ].forEach((sel) => qa(sel).forEach((n) => blocks.add(n)));

    return Array.from(blocks);
  }

  function manufacturerSections() {
    const blocks = new Set();

    // Headings
    findHeadingSections(/^\s*from\s+the\s+manufacturer\s*$/i).forEach((b) => blocks.add(b));

    // Known manufacturer A+ containers
    [
      "#aplusManufacturerDescription_feature_div",
      "[data-feature-name='aplusManufacturerDescription']",
      "[data-module-name='aplusManufacturerDescription']",
    ].forEach((sel) => qa(sel).forEach((n) => blocks.add(n)));

    return Array.from(blocks);
  }

  function descriptionSections() {
    const blocks = new Set();

    // Headings that literally say "Product Description"
    findHeadingSections(/^\s*product\s+description\s*$/i).forEach((b) => blocks.add(b));

    // Canonical containers
    [
      "#productDescription",
      "#aplus_feature_div",
      ".aplus-module",
      "[data-feature-name*='description']",
      "[data-module-name*='description']",
    ].forEach((sel) => qa(sel).forEach((n) => blocks.add(n)));

    return Array.from(blocks);
  }

  // ---------------- Text cleaners to avoid storing <img ...> etc. -------------
  const HTML_TAG_RE = /<[^>]+>/g;
  const IMG_EXT_URL_RE = /\bhttps?:\/\/\S+\.(?:jpg|jpeg|png)\b/ig;
  const MULTISPACE_RE = /\s{2,}/g;

  function stripHtmlAndImageUrls(s) {
    if (!s) return "";
    let t = s.replace(HTML_TAG_RE, " ");
    t = t.replace(IMG_EXT_URL_RE, " ");
    t = t.replace(MULTISPACE_RE, " ").trim();
    return t;
  }

  function nodeHasOnlyMedia(el) {
    // True if the node (or its descendants) are media-only OR remaining text is negligible
    if (!el) return false;
    const hasMedia =
      el.matches?.("img, picture, svg, video, canvas") ||
      el.querySelector?.("img, picture, svg, video, canvas");
    const t = txt(el);
    // if media exists and text is empty or just punctuation/short
    if (hasMedia && (!t || t.replace(/[\W_]+/g, "").length < 2)) return true;
    return false;
  }

  // ---------------- Rich text extraction for Brand/Manufacturer ----------------
  function collectReadableText(root) {
    // Only gather clearly copyable body text nodes (avoid buttons, links text like "Visit the Store")
    const nodes = qa(
      [
        "p",
        "li",
        "h3",
        "h4",
        "h5",
        ".aplus-p1",
        ".aplus-p2",
        ".aplus-p3",
        ".a-size-small",
        ".apm-brand-story-text h3",
        ".apm-brand-story-text p",
      ].join(","),
      root
    );

    const lines = [];
    const seen = new Set();

    nodes.forEach((el) => {
      // Skip pure-media containers or images-as-text blocks
      if (nodeHasOnlyMedia(el)) return;

      // Defensive: remove any HTML tags and image URLs from the text
      let t = txt(el);
      t = stripHtmlAndImageUrls(t);
      if (!t) return;

      // Skip store promo/navigation lines
      if (/visit\s+the\s+store/i.test(t)) return;
      if (/shop\s+all/i.test(t)) return;

      // Lightweight noise filter
      if (t.length < 3) return;

      // De-dupe by content
      if (!seen.has(t)) {
        seen.add(t);
        lines.push(t);
      }
    });

    // Join into multi-line text
    return lines.join("\n");
  }

  function getBrandTextAll() {
    const blocks = brandSections();
    const chunks = [];
    const seen = new Set();

    blocks.forEach((b) => {
      const t = collectReadableText(b);
      if (t) {
        // split by lines to avoid giant dupes
        t.split("\n").forEach((line) => {
          const L = stripHtmlAndImageUrls(line.trim());
          if (L && !seen.has(L)) {
            seen.add(L);
            chunks.push(L);
          }
        });
      }
    });

    // Final tidy
    return chunks
      .map((l) => l.replace(/\s{2,}/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }

  function getManufacturerTextAll() {
    const blocks = manufacturerSections();
    const chunks = [];
    const seen = new Set();

    blocks.forEach((b) => {
      const t = collectReadableText(b);
      if (t) {
        t.split("\n").forEach((line) => {
          const L = stripHtmlAndImageUrls(line.trim());
          if (L && !seen.has(L)) {
            seen.add(L);
            chunks.push(L);
          }
        });
      }
    });

    return chunks
      .map((l) => l.replace(/\s{2,}/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }

  // Build prioritized list: Brand -> Manufacturer -> Description (for OCR images)
  function getPriorityOcrImages(maxCount = 4) {
    const seen = new Set();
    const pick = [];

    const pushMany = (urls) => {
      for (const u of urls) {
        if (!seen.has(u)) {
          seen.add(u);
          pick.push(u);
          if (pick.length >= maxCount) break;
        }
      }
    };

    const brandImgs = brandSections().flatMap((root) => collectImgUrlsFromRoot(root));
    pushMany(brandImgs);

    if (pick.length < maxCount) {
      const manuImgs = manufacturerSections().flatMap((root) => collectImgUrlsFromRoot(root));
      pushMany(manuImgs);
    }

    if (pick.length < maxCount) {
      const descImgs = descriptionSections().flatMap((root) => collectImgUrlsFromRoot(root));
      pushMany(descImgs);
    }

    return pick.slice(0, maxCount);
  }

  // ---------------- Product core fields ----------------
  function readFromDetailsTables(labelList) {
    const tables = qa(
      "#productDetails_techSpec_section_1, #productDetails_detailBullets_sections1, #prodDetails"
    );
    for (const table of tables) {
      const rows = qa("tr, li", table);
      for (const row of rows) {
        const label = txt(q("th, .a-text-bold", row)).replace(":", "").toLowerCase();
        const value = txt(q("td, span:not(.a-text-bold)", row));
        for (const want of labelList) {
          if (label.includes(want.toLowerCase()) && value) return value;
        }
      }
    }
    return "";
  }

  const getTitle = () => txt(q("#productTitle"));
  const getBullets = () => qa("#feature-bullets ul li").map((li) => txt(li)).filter(Boolean);

  function getDescription() {
    const pd = q("#productDescription");
    if (pd) {
      const t = txt(pd);
      if (t) return t;
    }
    const aplus = q("#aplus_feature_div");
    if (aplus) {
      const p = qa("p", aplus).map((x) => txt(x)).filter(Boolean).join("\n");
      if (p) return p;
      const all = txt(aplus);
      if (all) return all;
    }
    return "";
  }

  // NOTE: For columns E and F we now want the *text* from Brand/Manufacturer sections
  const getBrandTextForSheet = () => getBrandTextAll(); // Column E
  const getManufacturerTextForSheet = () => getManufacturerTextAll(); // Column F (may be "")

  // (Optional fallback getters kept if needed elsewhere)
  const getBrandName = () => {
    const byline = txt(q("#bylineInfo"));
    if (byline) {
      let brand = byline.replace(/^Brand:\s*/i, "");
      brand = brand.replace(/^Visit the\s+(.+?)\s+Store$/i, "$1");
      return brand;
    }
    return readFromDetailsTables(["brand", "brand name"]);
  };
  const getManufacturerName = () => readFromDetailsTables(["manufacturer", "manufacturer ‏"]);

  function sendCore() {
    const titleEl = q("#productTitle");
    if (!titleEl) return;

    const data = {
      title: getTitle(),
      bullets: getBullets(),
      description: getDescription(),
      // Column E and F: supply copyable text from sections (stripped clean of images/HTML)
      brand: getBrandTextForSheet(),
      manufacturer: getManufacturerTextForSheet(),
    };

    chrome.runtime.sendMessage({ type: "SCRAPE_RESULT", data });
  }

  // Reply with prioritized OCR images when background asks
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "GET_OCR_IMAGES") {
      try {
        const images = getPriorityOcrImages(4);
        sendResponse({ images });
      } catch {
        sendResponse({ images: [] });
      }
      return true;
    }
    return false;
  });

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(sendCore, 1200);
  } else {
    window.addEventListener("DOMContentLoaded", () => setTimeout(sendCore, 1200));
  }
})();
