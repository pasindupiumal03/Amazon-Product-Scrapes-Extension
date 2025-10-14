# Testing Your Chrome Extension

## Quick Test Guide

### 1. Test Google Apps Script
First, verify your Google Apps Script is working:

1. Open your deployed Web App URL in a browser and add `?mode=get_asins`
   - Example: `https://script.google.com/macros/s/.../exec?mode=get_asins`
   - Should return: `{"asins":["B07518RBH2","..."]}`

### 2. Test Extension Loading
1. Go to `chrome://extensions/`
2. Find your extension and ensure it's enabled
3. Click the extension icon - popup should open

### 3. Quick Scraping Test
1. In your Google Sheet, put this test ASIN in cell A2: `B07518RBH2`
2. Configure your extension with the correct Google Apps Script URL
3. Click "Start" and watch for progress
4. Check if data appears in columns B-G

### 4. Expected Results
After successful scraping, you should see:
- **Column B**: Product title
- **Column C**: Bullet points (About this item)
- **Column D**: Product description  
- **Column E**: Brand name
- **Column F**: Manufacturer (if available)
- **Column G**: OCR text (if Vision API enabled)

## Common Test ASINs
These are reliable Amazon products for testing:
- `B07518RBH2` - Echo Dot
- `B08N5WRWNW` - Echo Show
- `B0BDPSTP2B` - Kindle
- `B09B8T73N6` - Fire TV Stick

## Debugging Tips

### Check Console Logs
1. **Background Script**: Go to `chrome://extensions/` → Your extension → "Service worker" → "Inspect"
2. **Content Script**: On Amazon product page → F12 → Console
3. **Popup**: Right-click extension icon → "Inspect popup"

### Common Issues
- **"No ASINs found"**: Check Column A has ASINs starting from A2
- **"Failed to fetch"**: Verify Google Apps Script URL and deployment
- **Empty data**: Amazon layout might be different - check content script logs

### Verify Extension Permissions
Make sure these permissions are granted:
- Storage (for saving configuration)
- Tabs (for opening Amazon pages)
- Scripting (for injecting content scripts)
- Host permissions for Amazon and Google services