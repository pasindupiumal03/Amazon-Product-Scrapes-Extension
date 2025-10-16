// Content script: runs on all URLs but self-filters to Amazon product pages and scrapes data.

(function () {
  try {
    const h = location.hostname || "";
    if (!/amazon\./i.test(h)) return; // not Amazon, bail
  } catch {
    return;
  }

  function txt(el) { return (el?.textContent || "").trim(); }
  function q(sel, root = document) { return root.querySelector(sel); }
  function qa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function readFromDetailsTables(labelList) {
    const tables = qa("#productDetails_techSpec_section_1, #productDetails_detailBullets_sections1, #prodDetails");
    for (const table of tables) {
      const rows = qa("tr, li", table);
      for (const row of rows) {
        const label = txt(q("th, .a-text-bold", row)).replace(":", "").toLowerCase();
        const value = txt(q("td, span:not(.a-text-bold)", row));
        for (const want of labelList) {
          if (label.includes(want.toLowerCase())) {
            if (value) return value;
          }
        }
      }
    }
    return "";
  }

  function getTitle() { return txt(q("#productTitle")); }
  function getBullets() {
    const items = qa("#feature-bullets ul li");
    return items.map(li => txt(li)).filter(Boolean);
  }
  function getDescription() {
    const pd = q("#productDescription");
    if (pd) {
      const t = txt(pd);
      if (t) return t;
    }
    const aplus = q("#aplus_feature_div");
    if (aplus) {
      const p = qa("p", aplus).map(x => txt(x)).filter(Boolean).join("\n");
      if (p) return p;
      const all = txt(aplus);
      if (all) return all;
    }
    return "";
  }
  function getBrand() {
    const byline = txt(q("#bylineInfo"));
    if (byline) {
      let brand = byline.replace(/^Brand:\s*/i, "");
      // Remove "Visit the ... Store" pattern
      brand = brand.replace(/^Visit the\s+(.+?)\s+Store$/i, "$1");
      return brand;
    }
    return readFromDetailsTables(["brand", "brand name"]);
  }
  function getManufacturer() {
    return readFromDetailsTables(["manufacturer", "manufacturer ‏"]);
  }
  function getBrandInfo() {
    // Look for "From the brand" section below bullet points
    const brandSection = q("#aplusBrandStory_feature_div") || 
                         q("[data-feature-name='aplusBrandStory']") ||
                         q("#aplus_feature_div [data-module-name='aplusBrandStory']");
    
    if (brandSection) {
      const text = txt(brandSection);
      if (text) return text;
    }
    
    // Alternative selectors for brand content
    const brandHeaders = qa("h3, h4, .a-text-bold").filter(h => 
      /from\s+the\s+brand/i.test(txt(h))
    );
    
    for (const header of brandHeaders) {
      let content = "";
      let nextEl = header.nextElementSibling;
      while (nextEl && !nextEl.matches("h1, h2, h3, h4, h5, h6")) {
        const elText = txt(nextEl);
        if (elText) content += elText + "\n";
        nextEl = nextEl.nextElementSibling;
      }
      if (content.trim()) return content.trim();
    }
    
    return "";
  }
  function getManufacturerInfo() {
    // Look for "From the manufacturer" section below bullet points
    const mfgSection = q("#aplusManufacturerDescription_feature_div") || 
                      q("[data-feature-name='aplusManufacturerDescription']") ||
                      q("#aplus_feature_div [data-module-name='aplusManufacturerDescription']");
    
    if (mfgSection) {
      const text = txt(mfgSection);
      if (text) return text;
    }
    
    // Alternative selectors for manufacturer content
    const mfgHeaders = qa("h3, h4, .a-text-bold").filter(h => 
      /from\s+the\s+manufacturer/i.test(txt(h))
    );
    
    for (const header of mfgHeaders) {
      let content = "";
      let nextEl = header.nextElementSibling;
      while (nextEl && !nextEl.matches("h1, h2, h3, h4, h5, h6")) {
        const elText = txt(nextEl);
        if (elText) content += elText + "\n";
        nextEl = nextEl.nextElementSibling;
      }
      if (content.trim()) return content.trim();
    }
    
    return "";
  }
  function getBrandImageUrls() {
    const urls = new Set();
    const brandSection = q("#aplusBrandStory_feature_div") || 
                         q("[data-feature-name='aplusBrandStory']") ||
                         q("#aplus_feature_div [data-module-name='aplusBrandStory']");
    if (brandSection) {
      qa("img", brandSection).forEach((img) => {
        const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
        if (src) urls.add(src);
      });
    }
    return Array.from(urls);
  }
  function getDescriptionImageUrls() {
    const urls = new Set();
    const pd = q("#productDescription");
    if (pd) {
      qa("img", pd).forEach((img) => {
        const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
        if (src) urls.add(src);
      });
    }
    const aplus = q("#aplus_feature_div");
    if (aplus) {
      qa("img", aplus).forEach((img) => {
        const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
        if (src) urls.add(src);
      });
    }
    return Array.from(urls);
  }
  function getImageUrls() {
    const urls = new Set();
    const main = q("#imgTagWrapperId img") || q("#landingImage");
    if (main) {
      const s1 = main.getAttribute("data-old-hires") || main.getAttribute("src") || "";
      if (s1) urls.add(s1);
    }
    qa("#altImages img").forEach(img => {
      let s = img.getAttribute("src") || "";
      s = s.replace(/_SX\d+_.*/i, "").replace(/_SS\d+_.*/i, "");
      if (s) urls.add(s);
    });
    return Array.from(urls).filter(Boolean);
  }

  function run() {
    const titleEl = q("#productTitle");
    if (!titleEl) return;

    const data = {
      title: getTitle(),
      bullets: getBullets(),
      description: getDescription(),
      brand: getBrand(),
      manufacturer: getManufacturer(),
      brandInfo: getBrandInfo(),
      manufacturerInfo: getManufacturerInfo(),
      imageUrls: getImageUrls(),
      brandImageUrls: getBrandImageUrls(),
      descriptionImageUrls: getDescriptionImageUrls()
    };

    chrome.runtime.sendMessage({ type: "SCRAPE_RESULT", data });
  }

  // Give Amazon a moment to finish dynamic bits
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(run, 1200);
  } else {
    window.addEventListener("DOMContentLoaded", () => setTimeout(run, 1200));
  }
})();
