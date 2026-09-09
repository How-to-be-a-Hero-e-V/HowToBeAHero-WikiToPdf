import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const env = (k: string, d: string) => process.env[k] ?? d;

/** Gemeinsames Geheimnis fuer die interne Schnittstelle des Wikis. Wird einmalig erzeugt. */
function ladeToken(dir: string): string {
  if (process.env.INTERNAL_TOKEN) return process.env.INTERNAL_TOKEN;
  try {
    mkdirSync(dir, { recursive: true });
    const datei = join(dir, "internal.token");
    if (!existsSync(datei)) { writeFileSync(datei, randomBytes(32).toString("hex"), { mode: 0o640 }); chmodSync(datei, 0o640); }
    return readFileSync(datei, "utf8").trim();
  } catch (e) { console.warn("Internes Token nicht verfuegbar:", String(e)); return ""; }
}

export const cfg = {
  port: Number(env("PORT", "3000")),
  wikiApi: env("WIKI_API", "http://mediawiki/api.php"),
  wikiIndex: env("WIKI_INDEX", "http://mediawiki/index.php"),
  wikiHost: env("WIKI_HOST", "howtobeahero.de"),
  publicWiki: env("PUBLIC_WIKI", "https://howtobeahero.de"),
  publicBase: env("PUBLIC_BASE", "/pdf").replace(/\/$/, ""),
  dataDir: env("DATA_DIR", "./data"),
  chromium: env("CHROMIUM_PATH", "/usr/bin/chromium"),
  catalogPage: env("CATALOG_PAGE", "MediaWiki:Wikitopdf-catalog.json"),
  prerenderAt: env("PRERENDER_AT", "04:15"),
  maxTitles: Number(env("MAX_TITLES", "40")),
  concurrency: Number(env("CONCURRENCY", "2")),
  queueMax: Number(env("QUEUE_MAX", "20")),
  jobsPerMinute: Number(env("JOBS_PER_MINUTE", "6")),
  cacheMaxBytes: Number(env("CACHE_MAX_BYTES", String(2e9))),
  cacheMaxAgeDays: Number(env("CACHE_MAX_AGE_DAYS", "30")),
  templateVersion: 4,
  internalToken: ladeToken(env("DATA_DIR", "./data")),
};
