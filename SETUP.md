# Amazon Product Scraper Chrome Extension

This Chrome extension scrapes product data from Amazon and saves it to Google Sheets with optional OCR functionality.

## Setup Instructions

### 1. Build the Extension
```bash
npm install
npm run build
```

### 2. Load Extension in Chrome
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `dist` folder in your project directory

### 3. Set up Google Apps Script
1. Create a new Google Apps Script project at `script.google.com`
2. Replace the default `Code.gs` with the provided code from your requirements
3. Deploy as Web App:
   - Click "Deploy" → "New deployment"
   - Choose "Web app" as type
   - Set "Execute as" to "Me"
   - Set "Who has access" to "Anyone"
   - Click "Deploy"
   - Copy the Web App URL (ends with `/exec`)

### 4. Prepare Google Sheets
1. Create a new Google Sheet
2. Put your ASINs (or full Amazon URLs) in Column A starting from A2
3. Example ASINs: `B07518RBH2`, `B08N5WRWNW`, etc.

### 5. Configure Extension
1. Click the extension icon in Chrome
2. Fill in the required fields:
   - **Google Apps Script URL**: Paste your Web App URL
   - **Google Vision API Key** (optional): For OCR functionality
   - **Amazon Domain**: e.g., `amazon.com`, `amazon.de`, etc.
3. Click "Save"

### 6. Start Scraping
1. Click "Start" button
2. Watch the progress in the popup
3. Check your Google Sheet - data will appear in columns B-G:
   - B: Product Title
   - C: Bullet Points (About this item)
   - D: Product Description
   - E: Brand
   - F: Manufacturer
   - G: OCR Text (if enabled)

## Features

- **Sequential Processing**: Processes ASINs one by one
- **Error Handling**: Skips failed ASINs without breaking the process
- **OCR Support**: Extract text from product images using Google Vision API
- **Progress Tracking**: Live progress updates in popup
- **Multi-domain Support**: Works with different Amazon domains

## Troubleshooting

### No data appearing in sheets
1. Check that your Google Apps Script Web App is deployed correctly
2. Test the Web App URL in browser: `YOUR_URL?mode=get_asins`
3. Ensure ASINs are in Column A starting from A2

### Extension not working
1. Check console for errors: Right-click extension → Inspect → Console
2. Ensure all permissions are granted
3. Try refreshing the Amazon page

### OCR not working
1. Verify your Google Vision API key is correct
2. Check if the API key has Vision API enabled
3. OCR only works on the first 3 images of each product

## Development

For development mode:
```bash
npm run dev
```

This will build in development mode with source maps for debugging.