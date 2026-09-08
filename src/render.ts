import { chromium, type Browser } from "playwright-core";
import { cfg } from "./config";

let browser: Browser | null = null;
const internalHost = new URL(cfg.wikiIndex).host;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    executablePath: cfg.chromium,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none", "--disable-extensions", "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults"],
  });
  browser.on("disconnected", () => { browser = null; });
  return browser;
}

export interface RenderResult { pdf: Uint8Array; pages: number; ms: number }

// Rendert das Buch-HTML mit Paged.js im Chromium nach PDF. Netzwerk: nur der Wiki-Container.
export async function renderPdf(html: string, opts: { timeoutMs?: number } = {}): Promise<RenderResult> {
  const t0 = Date.now();
  const b = await getBrowser();
  const ctx = await b.newContext({ javaScriptEnabled: true, bypassCSP: true });
  try {
    // Nur der Wiki-Container ist erreichbar. Interne Antworten laufen durch den Interceptor, damit
    // Chromiums Private-Network-Access-Pruefung (Dokument-Origin vs. lokale Adresse) nicht greift.
    await ctx.route("**/*", async route => {
      const u = new URL(route.request().url());
      if (u.protocol === "data:" || u.protocol === "about:") return route.continue();
      if (u.host !== internalHost) return route.abort();
      try { const r = await route.fetch({ headers: { ...route.request().headers(), host: cfg.wikiHost } }); await route.fulfill({ response: r }); }
      catch (e) { await route.abort().catch(() => {}); }
    });
    // Das Buch wird unter der internen Wiki-Origin ausgeliefert, damit Bilder same-origin sind
    // (Canvas-Verkleinerung ohne CORS) und relative Pfade auf den Wiki-Container zeigen.
    const bookUrl = `${new URL(cfg.wikiIndex).protocol}//${internalHost}/__wikitopdf__/book.html`;
    await ctx.route(bookUrl, route => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
    const page = await ctx.newPage();
    page.on("pageerror", e => console.warn("Seite (JS-Fehler):", e.message));
    page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.warn("Seite (console):", m.text().slice(0, 300)); });
    page.setDefaultTimeout(opts.timeoutMs ?? 180_000);
    await page.goto(bookUrl, { waitUntil: "load" });
    await page.waitForFunction(() => (window as any).__pagedDone === true, null, { timeout: opts.timeoutMs ?? 180_000 });
    await page.evaluate(() => document.fonts.ready);
    const pages = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    return { pdf: new Uint8Array(pdf), pages, ms: Date.now() - t0 };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function closeBrowser() { await browser?.close().catch(() => {}); browser = null; }
