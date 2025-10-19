(() => {
  // Only run on Amazon
  try {
    const h = location.hostname || "";
    if (!/amazon\./i.test(h)) return;
  } catch {
    return;
  }

  // Helper function to safely query selectors
  function safeQueryAll(selectors, root = document) {
    const results = [];
    selectors.forEach((sel) => {
      try {
        const elements = qa(sel, root);
        elements.forEach(el => results.push(el));
      } catch (e) {
        console.warn(`Invalid CSS selector: "${sel}", error:`, e.message);
      }
    });
    return results;
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
      "sprite", "spacer", "pixel", "favicon", "icon", "logo", "transparent", "placeholder"
    ];
    if (bad.some(k => hay.includes(k))) return false;

    // Skip commonly small grid thumbs
    if (/__ac_sr\d{2,3},\d{2,3}__/i.test(url)) return false;
    if (/_sx\d{2,3}_/i.test(url)) return false;
    if (/_ss\d{2,3}_/i.test(url)) return false;

    // Many A+ tiles show 166/182/220 widths — usually decorative
    if (/__ac_sr(16[0-9]|18[0-9]|22[0-9]),/i.test(url)) return false;

    return true;
  }

  function collectImgUrlsFromRoot(root) {
    const urls = new Set();

    // <img> tags - enhanced to check multiple possible src attributes
    qa("img", root).forEach((img) => {
      const alt = img.getAttribute("alt") || "";
      
      // Check multiple possible src attributes
      let src = 
        img.getAttribute("data-src") ||
        img.getAttribute("data-old-hires") ||
        img.getAttribute("data-a-dynamic-image-src") ||
        img.getAttribute("data-lazy-src") ||
        img.getAttribute("src") || "";
      
      src = normalizeImgUrl(src);
      if (isValidOcrImage(src, alt)) {
        urls.add(src);
        console.log(`Found image in ${root.className || 'unknown'}: ${src}`);
      }
    });

    // CSS background-image (often in Brand Story)
    qa("[style*='background-image']", root).forEach((node) => {
      const style = node.getAttribute("style") || "";
      const m = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
      if (m && m[2]) {
        const src = normalizeImgUrl(m[2]);
        if (isValidOcrImage(src)) {
          urls.add(src);
          console.log(`Found background image in ${root.className || 'unknown'}: ${src}`);
        }
      }
    });

    // data-a-dynamic-image JSON (common on Amazon product pages)
    qa("[data-a-dynamic-image]", root).forEach((node) => {
      try {
        const json = node.getAttribute("data-a-dynamic-image");
        const obj = JSON.parse(json);
        Object.keys(obj || {}).forEach((u) => {
          const src = normalizeImgUrl(u);
          if (isValidOcrImage(src)) {
            urls.add(src);
            console.log(`Found dynamic image in ${root.className || 'unknown'}: ${src}`);
          }
        });
      } catch {}
    });

    // Check for images in carousel cards and nested structures
    qa(".apm-brand-story-image-img, .apm-brand-story-background-image img, .aplus-module img", root).forEach((img) => {
      const alt = img.getAttribute("alt") || "";
      let src = 
        img.getAttribute("data-src") ||
        img.getAttribute("src") || "";
      
      src = normalizeImgUrl(src);
      if (isValidOcrImage(src, alt)) {
        urls.add(src);
        console.log(`Found nested structure image in ${root.className || 'unknown'}: ${src}`);
      }
    });

    // Check for images in noscript tags (fallback images)
    qa("noscript", root).forEach((noscript) => {
      const html = noscript.innerHTML || "";
      const imgMatch = html.match(/<img[^>]+src=['"?]([^'"?\s>]+)['"?][^>]*>/gi);
      if (imgMatch) {
        imgMatch.forEach((imgTag) => {
          const srcMatch = imgTag.match(/src=['"?]([^'"?\s>]+)['"?]/i);
          if (srcMatch && srcMatch[1]) {
            const src = normalizeImgUrl(srcMatch[1]);
            if (isValidOcrImage(src)) {
              urls.add(src);
              console.log(`Found noscript image in ${root.className || 'unknown'}: ${src}`);
            }
          }
        });
      }
    });

    console.log(`Total images found in section ${root.className || 'unknown'}: ${urls.size}`);
    return Array.from(urls);
  }

  // ---------------- Section finders ----------------
  function closestBlockForHeading(hEl) {
    // Try to find the most appropriate container for this heading
    let block = 
      hEl.closest(".bucket") || // Amazon's main section containers
      hEl.closest(".aplus-module") ||
      hEl.closest(".aplus-v2") ||
      hEl.closest("#aplus_feature_div") ||
      hEl.closest("#aplus") || // Added for aplus containers
      hEl.closest("[data-aplus-module]") ||
      hEl.closest(".apm-module-wrapper") ||
      hEl.closest(".apm-tablemodule") ||
      hEl.closest(".premium-module") ||
      hEl.closest("section") ||
      hEl.closest("article") ||
      hEl.closest(".feature") ||
      hEl.closest("div[id*='feature']") ||
      hEl.closest("div[class*='module']");

    // If no specific container found, try parent elements
    if (!block) {
      let parent = hEl.parentElement;
      let attempts = 0;
      while (parent && attempts < 8) { // Increased attempts for deeper nesting
        if (parent.children.length > 1 || parent.tagName === 'DIV') {
          // Prefer containers with meaningful content
          if (parent.className && (
            parent.className.includes('aplus') ||
            parent.className.includes('bucket') ||
            parent.className.includes('module') ||
            parent.className.includes('section')
          )) {
            block = parent;
            break;
          }
          if (!block) block = parent; // Keep as fallback
        }
        parent = parent.parentElement;
        attempts++;
      }
    }

    console.log(`Found block for heading "${txt(hEl)}": ${block?.className || block?.id || 'unknown'}`);
    return block || hEl.parentElement || document;
  }

  function findHeadingSections(regex) {
    const found = new Set();
    
    // Primary: Look for h2 tags first (as mentioned by user)
    qa("h2").forEach((h) => {
      const t = txt(h);
      if (regex.test(t)) {
        const block = closestBlockForHeading(h);
        if (block) found.add(block);
      }
    });
    
    // Secondary: Also check h3 tags as fallback
    qa("h3").forEach((h) => {
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
    console.log("=== Brand Section Detection Starting ===");

    // Enhanced heading detection for "From the brand"
    qa("h2").forEach((h) => {
      const t = txt(h).toLowerCase().trim();
      console.log(`Checking H2: "${t}"`);
      if (
        t.includes("from the brand") ||
        t.includes("from brand") ||
        t === "brand story" ||
        t === "about the brand" ||
        t.includes("brand information")
      ) {
        const block = closestBlockForHeading(h);
        if (block) {
          blocks.add(block);
          console.log(`✅ Found brand section via H2: "${t}" -> ${block.className || block.id || 'unknown'}`);
        }
      }
    });

    // Also check h3 as fallback
    qa("h3").forEach((h) => {
      const t = txt(h).toLowerCase().trim();
      if (
        t.includes("from the brand") ||
        t.includes("from brand") ||
        t === "brand story"
      ) {
        const block = closestBlockForHeading(h);
        if (block) {
          blocks.add(block);
          console.log(`✅ Found brand section via H3: "${t}" -> ${block.className || block.id || 'unknown'}`);
        }
      }
    });

    // Known Brand Story selectors - using safe query
    const brandSelectors = [
      "#aplusBrandStory_feature_div",
      "[data-feature-name='aplusBrandStory']",
      "[data-module-name='aplusBrandStory']",
      ".apm-brand-story-hero",
      ".apm-brand-story-card",
      ".apm-brand-story-carousel",
      ".aplus-brand-story-hero",
      ".aplus-brand-story",
      "[data-aplus-module*='brand']",
      ".brand-story",
      ".apm-brand-story-carousel-container",
      ".aplus-module[class*='brand-story-hero-1-image-logo']",
      ".aplus-module[class*='brand-story-card-1-four-asin']",
      ".aplus-module[class*='brand-story-card-2-media-asset']",
    ];
    
    console.log(`Testing ${brandSelectors.length} brand selectors...`);
    safeQueryAll(brandSelectors).forEach((n) => {
      blocks.add(n);
      console.log(`✅ Found brand section via selector: ${n.className || n.id || 'unknown'}`);
    });

    // SPECIAL CASE: If no brand sections found via headings,
    // check for aplus content that might be brand-related
    if (blocks.size === 0) {
      console.log("No brand sections found, checking aplus-v2 fallback...");
      qa(".aplus-v2").forEach((aplusDiv) => {
        const textContent = txt(aplusDiv).toLowerCase();
        const imageCount = qa("img", aplusDiv).length;
        
        console.log(`Analyzing aplus-v2: ${imageCount} images, text includes brand: ${textContent.includes("brand")}`);
        
        // Look for brand-related keywords in the content
        if (imageCount > 0 && (
          textContent.includes("brand") ||
          textContent.includes("company") ||
          textContent.includes("story") ||
          textContent.includes("values") ||
          textContent.includes("mission")
        )) {
          blocks.add(aplusDiv);
          console.log(`✅ Found brand section via content analysis: ${aplusDiv.className || aplusDiv.id || 'unknown'}`);
        }
      });
    }

    console.log(`=== Brand Section Detection Complete: ${blocks.size} sections found ===`);
    return Array.from(blocks);
  }

  function manufacturerSections() {
    const blocks = new Set();
    console.log("=== Manufacturer Section Detection Starting ===");

    // Enhanced heading detection for "From the manufacturer"
    qa("h2").forEach((h) => {
      const t = txt(h).toLowerCase().trim();
      console.log(`Checking H2: "${t}"`);
      if (
        t.includes("from the manufacturer") ||
        t.includes("from manufacturer") ||
        t === "manufacturer" ||
        t === "about the manufacturer" ||
        t.includes("manufacturer information") ||
        t.includes("manufacturer description")
      ) {
        const block = closestBlockForHeading(h);
        if (block) {
          blocks.add(block);
          console.log(`✅ Found manufacturer section via H2: "${t}" -> ${block.className || block.id || 'unknown'}`);
        }
      }
    });

    // Also check h3 as fallback
    qa("h3").forEach((h) => {
      const t = txt(h).toLowerCase().trim();
      if (
        t.includes("from the manufacturer") ||
        t.includes("from manufacturer") ||
        t === "manufacturer"
      ) {
        const block = closestBlockForHeading(h);
        if (block) {
          blocks.add(block);
          console.log(`✅ Found manufacturer section via H3: "${t}" -> ${block.className || block.id || 'unknown'}`);
        }
      }
    });

    // Known manufacturer A+ containers - using safe query
    const manufacturerSelectors = [
      "#aplusManufacturerDescription_feature_div",
      "[data-feature-name='aplusManufacturerDescription']",
      "[data-module-name='aplusManufacturerDescription']",
      "[data-aplus-module*='manufacturer']",
      ".manufacturer-description",
      ".aplus-manufacturer",
      ".aplus-module[class*='3p-module-b']",
      ".aplus-module[class*='module-12']",
      ".aplus-module[class*='module-4']",
      ".aplus-module[class*='module-5']",
    ];
    
    console.log(`Testing ${manufacturerSelectors.length} manufacturer selectors...`);
    safeQueryAll(manufacturerSelectors).forEach((n) => {
      blocks.add(n);
      console.log(`✅ Found manufacturer section via selector: ${n.className || n.id || 'unknown'}`);
    });

    // SPECIAL CASE: If no manufacturer sections found via headings,
    // but we have aplus-v2 content, include it as potential manufacturer content
    if (blocks.size === 0) {
      console.log("No manufacturer sections found, checking aplus-v2 fallback...");
      qa(".aplus-v2").forEach((aplusDiv) => {
        // Only add if it has substantial content (images + text)
        const imageCount = qa("img", aplusDiv).length;
        const textContent = txt(aplusDiv);
        console.log(`Analyzing aplus-v2: ${imageCount} images, text length: ${textContent.length}`);
        
        if (imageCount > 0 && textContent.length > 100) {
          blocks.add(aplusDiv);
          console.log(`✅ Found manufacturer section via content analysis: ${aplusDiv.className || aplusDiv.id || 'unknown'}`);
        }
      });
    }

    console.log(`=== Manufacturer Section Detection Complete: ${blocks.size} sections found ===`);
    return Array.from(blocks);
  }

  function descriptionSections() {
    const blocks = new Set();

    // Enhanced heading detection for "Product Description"
    qa("h2").forEach((h) => {
      const t = txt(h).toLowerCase().trim();
      if (
        t.includes("product description") ||
        t.includes("description") ||
        t === "about this item" ||
        t.includes("product details") ||
        t.includes("product information") ||
        t.includes("product features")
      ) {
        const block = closestBlockForHeading(h);
        if (block) blocks.add(block);
      }
    });

    // Also check h3 as fallback
    qa("h3").forEach((h) => {
      const t = txt(h).toLowerCase().trim();
      if (
        t.includes("product description") ||
        t.includes("description") ||
        t === "about this item"
      ) {
        const block = closestBlockForHeading(h);
        if (block) blocks.add(block);
      }
    });

    // Canonical containers - using safe query
    const descriptionSelectors = [
      "#productDescription",
      "#aplus_feature_div",
      ".aplus-module",
      "[data-feature-name*='description']",
      "[data-module-name*='description']",
      "[data-aplus-module*='description']",
      ".product-description",
      ".aplus-product-description",
      "#feature-bullets",
    ];
    
    safeQueryAll(descriptionSelectors).forEach((n) => {
      blocks.add(n);
      console.log(`Found description section via selector: ${n.className || n.id || 'unknown'}`);
    });

    // SPECIAL CASE: If no specific description sections found,
    // include general aplus content as potential product description
    if (blocks.size === 0) {
      qa(".aplus-v2").forEach((aplusDiv) => {
        const imageCount = qa("img", aplusDiv).length;
        const textContent = txt(aplusDiv);
        
        // Include if it has reasonable content (not just navigation/headers)
        if (imageCount > 0 && textContent.length > 50) {
          blocks.add(aplusDiv);
        }
      });
    }

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
    if (!el) return false;
    const hasMedia =
      el.matches?.("img, picture, svg, video, canvas") ||
      el.querySelector?.("img, picture, svg, video, canvas");
    const t = txt(el);
    if (hasMedia && (!t || t.replace(/[\W_]+/g, "").length < 2)) return true;
    return false;
  }

  // ---------------- Rich text extraction for Brand/Manufacturer ----------------
  function collectReadableText(root) {
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
      if (nodeHasOnlyMedia(el)) return;

      let t = txt(el);
      t = stripHtmlAndImageUrls(t);
      if (!t) return;

      if (/visit\s+the\s+store/i.test(t)) return;
      if (/shop\s+all/i.test(t)) return;

      if (t.length < 3) return;

      if (!seen.has(t)) {
        seen.add(t);
        lines.push(t);
      }
    });

    return lines.join("\n");
  }

  function getBrandTextAll() {
    const blocks = brandSections();
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

  // Build prioritized list: Brand -> Manufacturer -> Description -> Fallback (for OCR images)
  function getPriorityOcrImages(maxCount = 4) {
    const seen = new Set();
    const pick = [];

    const pushMany = (urls, sectionName) => {
      console.log(`=== Processing ${sectionName} section ===`);
      console.log(`Found ${urls.length} images in ${sectionName} section:`, urls);
      for (const u of urls) {
        if (!seen.has(u)) {
          seen.add(u);
          pick.push(u);
          console.log(`Added ${sectionName} image ${pick.length}: ${u}`);
          if (pick.length >= maxCount) {
            console.log(`Reached max count ${maxCount}, stopping`);
            break;
          }
        } else {
          console.log(`Skipping duplicate image: ${u}`);
        }
      }
    };

    // Get sections and log what we found
    console.log("=== Starting OCR image collection ===");
    const brandSecs = brandSections();
    const manuSecs = manufacturerSections();
    const descSecs = descriptionSections();
    
    console.log(`Found ${brandSecs.length} brand sections, ${manuSecs.length} manufacturer sections, ${descSecs.length} description sections`);

    // Remove any duplicate sections (e.g., if aplus-v2 appears in multiple categories)
    const allSections = new Set();
    const uniqueBrandSecs = brandSecs.filter(sec => {
      if (allSections.has(sec)) {
        console.log("Removing duplicate brand section:", sec.className || sec.id || 'unknown');
        return false;
      }
      allSections.add(sec);
      return true;
    });
    
    const uniqueManuSecs = manuSecs.filter(sec => {
      if (allSections.has(sec)) {
        console.log("Removing duplicate manufacturer section:", sec.className || sec.id || 'unknown');
        return false;
      }
      allSections.add(sec);
      return true;
    });
    
    const uniqueDescSecs = descSecs.filter(sec => {
      if (allSections.has(sec)) {
        console.log("Removing duplicate description section:", sec.className || sec.id || 'unknown');
        return false;
      }
      allSections.add(sec);
      return true;
    });

    console.log(`After deduplication: ${uniqueBrandSecs.length} brand, ${uniqueManuSecs.length} manufacturer, ${uniqueDescSecs.length} description sections`);

    const brandImgs = uniqueBrandSecs.flatMap((root) => collectImgUrlsFromRoot(root));
    pushMany(brandImgs, "brand");

    if (pick.length < maxCount) {
      const manuImgs = uniqueManuSecs.flatMap((root) => collectImgUrlsFromRoot(root));
      pushMany(manuImgs, "manufacturer");
    }

    if (pick.length < maxCount) {
      const descImgs = uniqueDescSecs.flatMap((root) => collectImgUrlsFromRoot(root));
      pushMany(descImgs, "description");
    }

    // ENHANCED FALLBACK: If we don't have enough images (less than maxCount), use fallback
    if (pick.length < maxCount) {
      const needed = maxCount - pick.length;
      console.log(`=== Only ${pick.length}/${maxCount} images found from sections, activating enhanced fallback for ${needed} more images ===`);
      const fallbackImages = getFallbackProductImages(maxCount);
      // Add fallback images, avoiding duplicates
      fallbackImages.forEach(img => {
        if (pick.length < maxCount && !pick.some(existing => existing.url === img)) {
          pushMany([img], "fallback");
        }
      });
    }

    // final sanity filter
    const final = pick.filter((u) => isValidOcrImage(u));
    console.log(`=== Final OCR images selected ===`);
    console.log(`Selected ${final.length}/${pick.length} valid images:`, final);
    return final.slice(0, maxCount);
  }

  // Enhanced fallback function to aggressively collect at least 4 product images
  function getFallbackProductImages(maxCount = 4) {
    console.log("=== Enhanced Fallback Product Image Collection Starting ===");
    const urls = new Set();
    
    // Strategy 1: Product gallery and main images (highest priority)
    console.log("Fallback: Collecting main product gallery images...");
    const gallerySelectors = [
      "#altImages img",
      "#imageBlock img", 
      "#landingImage",
      ".image img",
      "[data-a-dynamic-image]",
      "#main-image",
      ".s-image"
    ];
    
    gallerySelectors.forEach(selector => {
      try {
        qa(selector).forEach(img => {
          const src = normalizeImgUrl(
            img.getAttribute("data-src") ||
            img.getAttribute("src") ||
            img.getAttribute("data-a-dynamic-image") || ""
          );
          if (src && src.match(/\.(jpg|jpeg|png)$/i)) {
            urls.add(src);
            console.log(`Fallback: Added gallery image from ${selector}: ${src}`);
          }
        });
      } catch (e) {
        console.warn(`Fallback: Error with gallery selector ${selector}:`, e.message);
      }
    });
    
    // Strategy 2: Aggressive content area scanning
    console.log(`Fallback: Current count ${urls.size}, need ${maxCount}. Scanning content areas...`);
    const contentSelectors = [
      "#aplus_feature_div",
      "#aplus", 
      ".bucket",
      ".aplus-v2",
      ".aplus-module",
      "#productDescription",
      "[data-feature-name]",
      ".celwidget",
      "#feature-bullets",
      ".s-result-item",
      "[data-component-type]"
    ];
    
    contentSelectors.forEach(selector => {
      if (urls.size >= maxCount) return; // Stop if we have enough
      
      try {
        qa(selector).forEach(container => {
          const images = collectImgUrlsFromRoot(container);
          console.log(`Fallback: Found ${images.length} images in ${selector}`);
          images.forEach(img => {
            if (urls.size < maxCount * 2) { // Collect extra for filtering
              urls.add(img);
            }
          });
        });
      } catch (e) {
        console.warn(`Fallback: Error with selector ${selector}:`, e.message);
      }
    });
    
    // Strategy 3: If still need more, scan ALL page images with less restrictive filtering
    if (urls.size < maxCount) {
      console.log(`Fallback: Only ${urls.size} images found, scanning entire page for product images...`);
      qa("img").forEach(img => {
        if (urls.size >= maxCount * 3) return; // Collect plenty for filtering
        
        const src = normalizeImgUrl(
          img.getAttribute("data-src") ||
          img.getAttribute("src") ||
          img.getAttribute("data-a-dynamic-image") || ""
        );
        
        // Very permissive filtering - focus on Amazon image patterns
        if (src && src.match(/\.(jpg|jpeg|png)$/i)) {
          // Only skip obvious decorative/system images
          if (!/(sprite|spacer|pixel|favicon|transparent|placeholder|arrow|button|star|rating)/i.test(src) &&
              !/__ac_sr\d{1,2},\d{1,2}__/i.test(src) && // Allow most sizes
              !/_ss\d{1,2}_/i.test(src) &&
              !/\/G\/\d{2}\//i.test(src) && // Skip some Amazon system images
              src.length > 20) { // Ensure substantial URLs
            urls.add(src);
            console.log(`Fallback: Added page scan image: ${src}`);
          }
        }
      });
    }
    
    // Strategy 4: Try data attributes and noscript fallbacks
    if (urls.size < maxCount) {
      console.log(`Fallback: Still need more images (${urls.size}/${maxCount}), checking data attributes...`);
      qa("[data-a-dynamic-image], [data-src], noscript img").forEach(el => {
        if (urls.size >= maxCount * 3) return;
        
        let src = "";
        if (el.hasAttribute("data-a-dynamic-image")) {
          try {
            const dynamicData = JSON.parse(el.getAttribute("data-a-dynamic-image"));
            src = Object.keys(dynamicData)[0]; // Get first (usually largest) image
          } catch (e) {
            // Ignore parsing errors
          }
        } else {
          src = el.getAttribute("data-src") || el.getAttribute("src") || "";
        }
        
        src = normalizeImgUrl(src);
        if (src && src.match(/\.(jpg|jpeg|png)$/i) && src.length > 20) {
          urls.add(src);
          console.log(`Fallback: Added data attribute image: ${src}`);
        }
      });
    }
    
    const finalUrls = Array.from(urls)
      .filter(url => isValidOcrImage(url)) // Apply final validation
      .slice(0, maxCount);
    
    console.log(`=== Enhanced Fallback Complete: Found ${finalUrls.length}/${urls.size} valid images ===`);
    finalUrls.forEach((url, i) => console.log(`${i+1}. ${url}`));
    return finalUrls;
  }

  function getLabelFromProductDetail(labelList) {
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

  // For Sheet columns E/F: supply copyable text from Brand/Manufacturer sections
  const getBrandTextForSheet = () => getBrandTextAll(); // Column E
  const getManufacturerTextForSheet = () => getManufacturerTextAll(); // Column F (may be "")

  function sendCore() {
    const titleEl = q("#productTitle");
    if (!titleEl) return;

    const data = {
      title: getTitle(),
      bullets: getBullets(),
      description: getDescription(),
      brand: getBrandTextForSheet(),
      manufacturer: getManufacturerTextForSheet(),
    };

    chrome.runtime.sendMessage({ type: "SCRAPE_RESULT", data });
  }

  // Reply with prioritized OCR images when background asks
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "GET_OCR_IMAGES") {
      try {
        console.log("=== Content Script: GET_OCR_IMAGES Request ===");
        console.log("Current URL:", window.location.href);
        console.log("Page title:", document.title);
        
        const images = getPriorityOcrImages(4);
        console.log(`Content Script: Returning ${images.length} images to background:`, images);
        
        sendResponse({ images });
      } catch (e) {
        console.error("Content Script: Error in GET_OCR_IMAGES:", e);
        sendResponse({ images: [] });
      }
      return true;
    }
    
    // Debug helper to check what sections are found
    if (msg && msg.type === "DEBUG_SECTIONS") {
      try {
        const brand = brandSections();
        const manufacturer = manufacturerSections(); 
        const description = descriptionSections();
        
        // Get all h2 tags for debugging
        const allH2s = qa("h2").map(h => ({
          text: txt(h),
          id: h.id || 'no-id',
          class: h.className || 'no-class'
        }));

        // Get all aplus-v2 containers
        const aplusV2s = qa(".aplus-v2").map(div => ({
          id: div.id || 'no-id',
          class: div.className || 'no-class',
          textPreview: txt(div).substring(0, 100) + '...',
          imageCount: qa("img", div).length
        }));

        // Get detailed image analysis
        const brandImages = brand.flatMap(root => {
          const images = collectImgUrlsFromRoot(root);
          return images.map(url => ({url, section: 'brand', container: root.className || root.id || 'unknown'}));
        });
        
        const manufacturerImages = manufacturer.flatMap(root => {
          const images = collectImgUrlsFromRoot(root);
          return images.map(url => ({url, section: 'manufacturer', container: root.className || root.id || 'unknown'}));
        });
        
        const descriptionImages = description.flatMap(root => {
          const images = collectImgUrlsFromRoot(root);
          return images.map(url => ({url, section: 'description', container: root.className || root.id || 'unknown'}));
        });

        // Get priority OCR images with detailed info
        const priorityImages = getPriorityOcrImages(4);
        
        sendResponse({ 
          brand: brand.length,
          manufacturer: manufacturer.length,
          description: description.length,
          allH2s: allH2s,
          aplusV2s: aplusV2s,
          brandImages: brandImages,
          manufacturerImages: manufacturerImages,
          descriptionImages: descriptionImages,
          priorityImages: priorityImages,
          totalImages: qa("img").length,
          totalAplusV2: qa(".aplus-v2").length,
          pageTitle: document.title,
          currentUrl: window.location.href
        });
      } catch (e) {
        sendResponse({ error: e.message, stack: e.stack });
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