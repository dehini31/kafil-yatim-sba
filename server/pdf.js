"use strict";
const {pageSize} = require("./print");

let browserPromise;
function browser() {
  if (!browserPromise) {
    const {chromium} = require("playwright");
    const options = {args: ["--no-sandbox", "--font-render-hinting=none"]};
    if (process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
    // Bundled Chromium if present, otherwise the Chrome or Edge already installed on the computer.
    const attempt = async () => {
      let last;
      for (const extra of [{}, {channel: "chrome"}, {channel: "msedge"}]) {
        try { return await chromium.launch({...options, ...extra}); } catch (error) { last = error; }
      }
      throw new Error("Aucun navigateur trouvé pour générer le PDF (installez Google Chrome ou Microsoft Edge). " + last.message.split("\n")[0]);
    };
    browserPromise = attempt().catch(error => { browserPromise = null; throw error; });
  }
  return browserPromise;
}
async function close() {
  if (browserPromise) { const b = await browserPromise; browserPromise = null; await b.close(); }
}

async function withPage(html, config, fn) {
  const b = await browser();
  const {w, h} = pageSize(config);
  const context = await b.newContext({viewport: {width: Math.ceil(w * 96 / 25.4), height: Math.ceil(h * 96 / 25.4)}});
  try {
    const page = await context.newPage();
    await page.setContent(html, {waitUntil: "load"});
    await page.waitForFunction("window.__layout && window.__layout.ready", null, {timeout: 15000});
    return await fn(page);
  } finally {
    await context.close();
  }
}

// Layout checks measured in the same engine that prints the PDF.
const analyze = (html, config) => withPage(html, config, page => page.evaluate(() => window.__layout));

// Chromium rounds the page to whole CSS pixels (up to ~0.2 mm off): pin the boxes to the exact size.
async function exactSize(bytes, w, h) {
  const {PDFDocument} = require("pdf-lib");
  const doc = await PDFDocument.load(bytes);
  const pt = mm => mm * 72 / 25.4;
  const page = doc.getPage(0);
  for (const box of ["MediaBox", "CropBox", "TrimBox", "BleedBox"]) {
    page[`set${box}`](0, 0, pt(w), pt(h));
  }
  return Buffer.from(await doc.save());
}

async function render(html, config) {
  const {w, h} = pageSize(config);
  return withPage(html, config, async page => {
    const layout = await page.evaluate(() => window.__layout);
    const pdf = await page.pdf({width: `${w}mm`, height: `${h}mm`, printBackground: true, margin: {top: 0, right: 0, bottom: 0, left: 0},
      preferCSSPageSize: true});
    return {pdf: await exactSize(pdf, w, h), layout};
  });
}
module.exports = {render, analyze, close};
