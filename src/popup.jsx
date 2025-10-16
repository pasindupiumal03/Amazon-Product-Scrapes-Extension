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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-blue-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-6 shadow-lg">
        <div className="flex items-center space-x-3">
          <img 
            src="./assets/icons/amazon.logo.png" 
            alt="Amazon Logo" 
            className="w-32 h-32 object-contain"
            style={{
              imageRendering: 'crisp-edges',
              WebkitImageRendering: 'crisp-edges',
              msImageRendering: 'crisp-edges',
              imageRendering: '-webkit-optimize-contrast'
            }}
          />
          <div>
            <h1 className="text-white text-xl font-bold">Amazon Product Scraper</h1>
            <p className="text-orange-100 text-sm">Extract product data to Google Sheets</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Configuration Section */}
        <div className="bg-white rounded-xl shadow-md p-5 border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
            <svg className="w-5 h-5 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Configuration
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Google Apps Script Web App URL *
              </label>
              <input
                value={gas}
                onChange={(e) => setGas(e.target.value)}
                placeholder="https://script.google.com/macros/s/XXXX/exec"
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                OCR.space API Key (Optional)
              </label>
              <input
                value={vision}
                onChange={(e) => setVision(e.target.value)}
                placeholder="K85105510988957 (for OCR text extraction)"
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">Provide your OCR.space API key to extract text from product images</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amazon Domain
              </label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="amazon.com, amazon.de, amazon.co.uk"
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors text-sm"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button 
              onClick={save} 
              className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg"
            >
              💾 Save Configuration
            </button>
            <button 
              onClick={start} 
              className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg"
            >
              🚀 Start Scraping
            </button>
          </div>
        </div>

        {/* Status Section */}
        {(status || progress.total > 0) && (
          <div className="bg-white rounded-xl shadow-md p-5 border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
              <svg className="w-5 h-5 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Progress Status
            </h3>
            
            {status && (
              <div className="mb-3">
                <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
                  status.includes('Error') 
                    ? 'bg-red-50 text-red-700 border border-red-200' 
                    : status.includes('Done') 
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}>
                  {status}
                </div>
              </div>
            )}
            
            {progress.total > 0 && (
              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm text-gray-600">
                  <span>Processing ASIN {progress.idx} of {progress.total}</span>
                  <span className="font-medium">{Math.round((progress.idx / progress.total) * 100)}%</span>
                </div>
                
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-gradient-to-r from-orange-500 to-amber-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(progress.idx / progress.total) * 100}%` }}
                  ></div>
                </div>
                
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Current ASIN:</p>
                  <p className="font-mono text-sm font-medium text-gray-800">{progress.asin}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Info Section */}
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-5 border border-indigo-200">
          <h3 className="text-lg font-semibold text-indigo-800 mb-3 flex items-center">
            <svg className="w-5 h-5 mr-2 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            How it Works
          </h3>
          <div className="space-y-2 text-sm text-indigo-700">
            <p>• Put ASINs in Column A of your Google Sheet (starting from A2)</p>
            <p>• Configure your Google Apps Script Web App URL above</p>
            <p>• Click "Start Scraping" to begin extracting product data</p>
            <p>• Data will appear in columns B-G: Title, Bullets, Description, Brand, Manufacturer, OCR Text</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("react-target"));
root.render(<Popup />);
