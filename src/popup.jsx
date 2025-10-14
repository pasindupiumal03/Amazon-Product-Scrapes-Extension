import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function Popup() {
  const [gas, setGas] = useState("");
  const [vision, setVision] = useState("");
  const [domain, setDomain] = useState("amazon.com");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState({ idx: 0, total: 0, asin: "" });

  useEffect(() => {
    chrome.storage.local.get(["GAS_ENDPOINT", "VISION_API_KEY", "AMAZON_DOMAIN"], (v) => {
      setGas(v.GAS_ENDPOINT || "");
      setVision(v.VISION_API_KEY || "");
      setDomain(v.AMAZON_DOMAIN || "amazon.com");
    });

    const handler = (msg) => {
      if (msg?.type === "RUN_STATUS") {
        if (msg.status === "started") setStatus("Processing…");
        else if (msg.status === "done")
          setStatus(`Done ✅  Success: ${msg.success}  Failed: ${msg.failed}  Total: ${msg.total}`);
        else if (msg.status === "error") setStatus(`Error: ${msg.message}`);
      }
      if (msg?.type === "RUN_PROGRESS") {
        setProgress({ idx: msg.index, total: msg.total, asin: msg.asin });
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const save = async () => {
    const raw = (domain || "").trim();
    let norm = raw;
    try {
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        norm = u.hostname;
      }
      norm = norm.replace(/^https?:\/\//i, "").replace(/^www\./i, "").trim();
      if (!norm || !/amazon\./i.test(norm)) norm = "amazon.com";
    } catch {
      norm = "amazon.com";
    }

    await chrome.storage.local.set({
      GAS_ENDPOINT: gas.trim(),
      VISION_API_KEY: vision.trim(),
      AMAZON_DOMAIN: norm
    });
    setDomain(norm);
    setStatus("Saved ✅");
  };

  const start = async () => {
    setStatus("");
    chrome.runtime.sendMessage({ type: "START_SCRAPE" });
  };

  return (
    <div className="w-full h-full p-4 bg-white text-black">
      <h1 className="text-xl font-semibold mb-3">Amazon ➜ Sheets Scraper</h1>

      <label className="block text-sm mb-1">Google Apps Script Web App URL</label>
      <input
        value={gas}
        onChange={(e) => setGas(e.target.value)}
        placeholder="https://script.google.com/macros/s/XXXX/exec"
        className="w-full border rounded px-2 py-1 mb-3"
      />

      <label className="block text-sm mb-1">Google Vision API Key (optional for OCR)</label>
      <input
        value={vision}
        onChange={(e) => setVision(e.target.value)}
        placeholder="AIzaSy..."
        className="w-full border rounded px-2 py-1 mb-3"
      />

      <label className="block text-sm mb-1">Amazon Domain</label>
      <input
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="amazon.com (or amazon.de, amazon.co.uk)"
        className="w-full border rounded px-2 py-1 mb-3"
      />

      <div className="flex gap-2">
        <button onClick={save} className="px-3 py-1 rounded bg-black text-white">Save</button>
        <button onClick={start} className="px-3 py-1 rounded bg-black text-white">Start</button>
      </div>

      <div className="mt-4 text-sm">
        <div className="font-medium">{status}</div>
        {progress.total > 0 && (
          <div className="mt-1">
            ASIN {progress.idx}/{progress.total}: <span className="font-mono">{progress.asin}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("react-target"));
root.render(<Popup />);
