import { cfg } from "./config";
import { specFromQuery, specToQuery, fileName, HttpError, resolve } from "./book";
import { resolvedCatalog, loadCatalog, invalidateCatalog } from "./catalog";
import * as jobs from "./jobs";
import { join } from "node:path";

const pub = join(import.meta.dir, "..", "public");
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const text = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const ipOf = (req: Request, server: any) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || server.requestIP(req)?.address || "?";

function pdfResponse(path: string, name: string, download: boolean) {
  const f = Bun.file(path);
  const cd = `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`;
  return new Response(f, { headers: { "content-type": "application/pdf", "content-disposition": cd, "cache-control": "private, max-age=3600" } });
}

function waitPage(job: jobs.Job, shareUrl: string): Response {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(job.spec.title)} – PDF wird erstellt</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cfg.publicBase}/app.css"></head>
<body class="wait"><main class="card"><img src="${cfg.publicBase}/logo.png" class="logo" alt="How to be a Hero">
<img src="${cfg.publicBase}/assets/Howky_lesen.png" class="howky" alt="">
<h1>${esc(job.spec.title)}</h1><p id="msg">Howky blättert schon: Das Buch wird gesetzt, das dauert meist unter einer Minute.</p>
<div class="bar"><div id="fill"></div></div><p id="dl" hidden><a class="btn" id="dlink" href="#">PDF herunterladen</a></p>
<p class="small">Teilen-Link: <code>${esc(shareUrl)}</code><br><a href="${cfg.publicBase}/">Zurück zum Buch-Baukasten</a></p></main>
<script>const base=${JSON.stringify(cfg.publicBase)};const id=${JSON.stringify(job.id)};let n=0;
async function poll(){n++;try{const r=await fetch(base+"/api/jobs/"+id);const j=await r.json();document.getElementById("msg").textContent=j.message||"";
document.getElementById("fill").style.width=Math.min(95,n*4)+"%";
if(j.state==="done"){document.getElementById("fill").style.width="100%";const a=document.getElementById("dlink");a.href=base+"/api/jobs/"+id+"/download";document.getElementById("dl").hidden=false;location.href=a.href;return;}
if(j.state==="error"){document.getElementById("msg").textContent="Fehler: "+(j.error||"unbekannt");return;}}catch(e){}setTimeout(poll,1500);}poll();</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function handle(req: Request, server: any): Promise<Response> {
  const url = new URL(req.url);
  let path = url.pathname;
  if (cfg.publicBase && path.startsWith(cfg.publicBase)) path = path.slice(cfg.publicBase.length) || "/";
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "HEAD") return text("Method not allowed", 405);

  if (path === "/healthz") return text("ok");
  if (path === "/" || path === "/index.html") return new Response(Bun.file(join(pub, "index.html")), { headers: { "content-type": "text/html; charset=utf-8" } });
  if (path === "/app.js" || path === "/app.css") return new Response(Bun.file(join(pub, path.slice(1))), { headers: { "cache-control": "public, max-age=300" } });
  if (/^\/assets\/[\w./-]+$/.test(path) && !path.includes("..")) {
    const f = Bun.file(join(pub, path.slice(1)));
    if (await f.exists()) return new Response(f, { headers: { "cache-control": "public, max-age=86400" } });
  }
  if (path === "/logo.png") return new Response(Bun.file(join(import.meta.dir, "..", "template/images/LogoHD_300dpi.png")), { headers: { "cache-control": "public, max-age=86400" } });

  if (path === "/api/catalog") {
    const c = await resolvedCatalog();
    return json({ rulebook: c.rulebook, modules: c.modules, adventures: c.adventures, sheets: c.sheets, books: c.books, maxTitles: cfg.maxTitles, base: cfg.publicBase, wiki: cfg.publicWiki });
  }
  if (path === "/api/catalog/refresh" && req.method === "POST") { invalidateCatalog(); return json({ ok: true }); }

  // Entwicklung: fertiges Buch-HTML ansehen (DEBUG_HTML=1)
  if (path === "/api/debug/html" && process.env.DEBUG_HTML === "1") {
    const { debugHtml } = await import("./book");
    return new Response(await debugHtml(await specFromQuery(url.searchParams)), { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // Buch anfordern: Cache-Treffer -> PDF direkt, sonst Warteseite mit Auftrag
  if (path === "/book" || path === "/api/jobs") {
    const q = req.method === "POST" ? new URLSearchParams(await req.text()) : url.searchParams;
    const spec = await specFromQuery(q);
    const r = await resolve(spec);
    const name = fileName(spec);
    const shareUrl = `${cfg.publicWiki}${cfg.publicBase}/book?${specToQuery(spec, (await loadCatalog()).rulebook.chapters)}`;
    const hit = await (await import("./cache")).cacheGet(r.key);
    if (hit && path === "/book") return pdfResponse(hit, name, q.get("dl") === "1");
    if (!jobs.allow(ipOf(req, server))) return text("Zu viele Anfragen, bitte in einer Minute noch einmal.", 429);
    const job = await jobs.submit(spec);
    if (path === "/api/jobs") return json({ id: job.id, state: job.state, message: job.message, share: shareUrl, file: name });
    return waitPage(job, shareUrl);
  }
  const m = path.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/download)?$/);
  if (m) {
    const job = jobs.get(m[1]);
    if (!job) return json({ error: "Auftrag unbekannt oder abgelaufen" }, 404);
    if (m[2]) {
      if (job.state !== "done" || !job.path) return json({ error: "Noch nicht fertig" }, 409);
      return pdfResponse(job.path, fileName(job.spec), true);
    }
    return json({ id: job.id, state: job.state, message: job.message, error: job.error });
  }
  return text("Nicht gefunden", 404);
}

// Vordefinierte Buecher nachts vorrendern (beide Formate), damit Downloads sofort und aktuell sind
async function prerender() {
  const cat = await loadCatalog();
  for (const id of Object.keys(cat.books)) for (const fmt of ["a4", "a5"]) {
    try {
      const spec = await specFromQuery(new URLSearchParams({ book: id, fmt }));
      const job = await jobs.submit(spec);
      while (job.state === "queued" || job.state === "running") await Bun.sleep(1000);
      console.log(`Vorrendern ${id}/${fmt}: ${job.state === "done" ? job.message : "Fehler: " + job.error}`);
    } catch (e) { console.error(`Vorrendern ${id}/${fmt} fehlgeschlagen:`, String(e)); }
  }
}
function scheduleDaily() {
  const [h, m] = cfg.prerenderAt.split(":").map(Number);
  const next = new Date(); next.setHours(h, m, 0, 0); if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  setTimeout(() => { void prerender(); scheduleDaily(); }, next.getTime() - Date.now());
}
scheduleDaily();
setTimeout(() => void prerender(), 30_000);

Bun.serve({
  port: cfg.port,
  idleTimeout: 120,
  async fetch(req, server) {
    try { return await handle(req, server); }
    catch (e: any) {
      if (e instanceof HttpError) return text(e.message, e.status);
      if (e instanceof jobs.TooBusy) return text(e.message, 503);
      console.error(e);
      return text("Interner Fehler: " + (e?.message ?? e), 500);
    }
  },
});
console.log(`WikiToPdf v2 laeuft auf :${cfg.port}, Basis ${cfg.publicBase}, Wiki ${cfg.wikiApi}`);
