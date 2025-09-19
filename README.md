# Development: Next.js + Plasmo Extension

To develop and test both your Next.js API endpoints and your Plasmo-powered Chrome extension, follow these steps:

## 1. Start the Next.js Server (for API endpoints)

This serves your API routes (e.g., `/api/hello`).

```bash
npm run dev:next
```

- By default, this runs on [http://localhost:1947](http://localhost:1947)

## 2. Start the Plasmo Chrome Extension Dev Server

This builds and serves your extension for local development.

```bash
npm run dev:plasmo
```

- This generates a `.plasmo/` directory in your project root.

## 3. Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `.plasmo/` directory in your project root
# hyperliquid-extension
# hyperextension
