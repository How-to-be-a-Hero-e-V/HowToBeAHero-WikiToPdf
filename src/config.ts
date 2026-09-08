const env = (k: string, d: string) => process.env[k] ?? d;

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
  templateVersion: 3,
};
