import { cfg } from "./config";
import { loadCatalog, resolvedCatalog, type Catalog } from "./catalog";
import { pageInfo, parseRevision, fetchFile } from "./wiki";
import { cleanChapter, buildDocument, decode, type Book, type Part, type Chapter } from "./html";
import { renderPdf } from "./render";
import { finalizeBook } from "./pdf";
import { cacheGet, cachePut } from "./cache";

export interface BookSpec {
  title: string;
  fmt: "a4" | "a5";
  rules: string[];       // Regelwerk-Kapitel in Katalogreihenfolge
  modules: string[];
  adventures: string[];
  pages: string[];       // freie Seiten
  sheet: string | null;  // leere Vorlage
  boegen: string[];      // gespeicherte Charakterbögen
}

const splitList = (s: string | null) => (s ?? "").split("|").map(t => t.trim().replace(/_/g, " ")).filter(Boolean);

// Baut aus Query-Parametern eine Buchdefinition; vordefinierte Buecher (?book=regelwerk) werden aufgeloest.
export async function specFromQuery(q: URLSearchParams): Promise<BookSpec> {
  const cat = await loadCatalog();
  let spec: BookSpec = { title: "", fmt: "a4", rules: [], modules: [], adventures: [], pages: [], sheet: null, boegen: [] };
  const bookId = q.get("book");
  if (bookId) {
    const def = cat.books[bookId];
    if (!def) throw new HttpError(404, `Unbekanntes Buch: ${bookId}`);
    spec.title = def.title;
    spec.rules = def.rules === "all" ? [...cat.rulebook.chapters] : (def.rules ?? []);
    spec.modules = def.modules ?? []; spec.adventures = def.adventures ?? []; spec.pages = def.pages ?? [];
    spec.sheet = def.sheet ?? null;
  }
  if (q.has("rules")) spec.rules = q.get("rules") === "all" ? [...cat.rulebook.chapters] : splitList(q.get("rules"));
  if (q.has("modules")) spec.modules = splitList(q.get("modules"));
  if (q.has("adventures")) spec.adventures = splitList(q.get("adventures"));
  if (q.has("pages")) spec.pages = splitList(q.get("pages"));
  if (q.has("sheet")) spec.sheet = q.get("sheet") || null;
  if (q.has("boegen")) spec.boegen = (q.get("boegen") ?? "").split("|").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9]{4,24}$/.test(s)).slice(0, 12);
  if (q.get("fmt") === "a5") spec.fmt = "a5";
  if (q.get("title")) spec.title = q.get("title")!.slice(0, 80);
  // Regelwerk immer in Katalogreihenfolge
  const order = new Map(cat.rulebook.chapters.map((c, i) => [c.toLowerCase(), i]));
  spec.rules = [...new Set(spec.rules)].sort((a, b) => (order.get(a.toLowerCase()) ?? 999) - (order.get(b.toLowerCase()) ?? 999));
  spec.modules = [...new Set(spec.modules)]; spec.adventures = [...new Set(spec.adventures)]; spec.pages = [...new Set(spec.pages)];
  if (spec.sheet && !cat.sheets.some(s => s.id === spec.sheet)) throw new HttpError(400, `Unbekannter Charakterbogen: ${spec.sheet}`);
  const total = spec.rules.length + spec.modules.length + spec.adventures.length + spec.pages.length;
  if (total === 0 && !spec.sheet && !spec.boegen.length) throw new HttpError(400, "Keine Seiten ausgewählt.");
  if (total > cfg.maxTitles) throw new HttpError(400, `Höchstens ${cfg.maxTitles} Seiten pro Buch.`);
  if (!spec.title) spec.title = defaultTitle(spec, cat);
  return spec;
}

function defaultTitle(spec: BookSpec, cat: Catalog): string {
  const all = spec.rules.length === cat.rulebook.chapters.length;
  const parts: string[] = [];
  if (spec.rules.length) parts.push(all ? "Regelwerk" : "Regelauszug");
  if (spec.modules.length) parts.push(spec.modules.length === 1 ? spec.modules[0] : `${spec.modules.length} Module`);
  if (spec.adventures.length) parts.push(spec.adventures.length === 1 ? spec.adventures[0] : `${spec.adventures.length} Abenteuer`);
  if (spec.pages.length) parts.push(spec.pages.length === 1 ? spec.pages[0] : `${spec.pages.length} Seiten`);
  if (spec.boegen.length) parts.push(spec.boegen.length === 1 ? "1 Charakterbogen" : `${spec.boegen.length} Charakterbögen`);
  if (!parts.length && spec.sheet) parts.push("Charakterbogen");
  return parts.join(" · ");
}

export function specToQuery(spec: BookSpec, allChapters: string[] = []): string {
  const q = new URLSearchParams();
  const all = allChapters.length && spec.rules.length === allChapters.length;
  if (spec.rules.length) q.set("rules", all ? "all" : spec.rules.join("|"));
  if (spec.modules.length) q.set("modules", spec.modules.join("|"));
  if (spec.adventures.length) q.set("adventures", spec.adventures.join("|"));
  if (spec.pages.length) q.set("pages", spec.pages.join("|"));
  if (spec.sheet) q.set("sheet", spec.sheet);
  if (spec.boegen.length) q.set("boegen", spec.boegen.join("|"));
  q.set("fmt", spec.fmt);
  q.set("title", spec.title);
  return q.toString();
}

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

interface Resolved { spec: BookSpec; key: string; parts: { id: string; name: string; chapters: { id: string; title: string; wikiTitle: string; revid: number }[] }[]; sheetFile?: string; sheetName?: string; boegen: { id: string; titel: string; geaendert: string }[]; privat: boolean }

// Titel pruefen, Revisionen holen, Cache-Schluessel bilden.
export async function resolve(spec: BookSpec, nutzer?: { id: number; gruppen: string[] } | null): Promise<Resolved> {
  const cat = await loadCatalog();
  const groups: { id: string; name: string; titles: string[] }[] = [
    { id: "regelwerk", name: cat.rulebook.name, titles: spec.rules },
    { id: "module", name: cat.modules.name, titles: spec.modules },
    { id: "abenteuer", name: cat.adventures.name, titles: spec.adventures },
    { id: "seiten", name: "Weitere Seiten", titles: spec.pages },
  ].filter(g => g.titles.length);
  const all = groups.flatMap(g => g.titles);
  const infos = await pageInfo(all);
  const byQuery = new Map(infos.map(i => [i.query.toLowerCase(), i]));
  const missing: string[] = [];
  let n = 0;
  const seen = new Set<string>();
  const parts = groups.map(g => ({
    id: g.id, name: g.name,
    chapters: g.titles.map(t => {
      const info = byQuery.get(t.toLowerCase());
      if (!info || !info.exists) { missing.push(t); return null; }
      if (!cat.allowedNamespaces.includes(info.ns)) throw new HttpError(403, `Seite nicht erlaubt: ${info.title}`);
      if (seen.has(info.title)) return null; // Weiterleitung auf eine schon enthaltene Seite
      seen.add(info.title);
      n++;
      return { id: `c${n}`, title: info.title.replace(/^Kategorie:/, ""), wikiTitle: info.title, revid: info.revid };
    }).filter((c): c is NonNullable<typeof c> => !!c),
  })).filter(p => p.chapters.length);
  if (missing.length) throw new HttpError(404, `Seite nicht gefunden: ${missing.join(", ")}`);
  const sheet = spec.sheet ? cat.sheets.find(s => s.id === spec.sheet) : undefined;
  // Charakterbögen: eigene immer, freigegebene für angemeldete Nutzer, alles für Admins
  const store = await import("./store");
  const boegen: { id: string; titel: string; geaendert: string }[] = [];
  let privat = false;
  const admin = !!nutzer && (nutzer.gruppen.includes("sysop") || nutzer.gruppen.includes("bureaucrat"));
  for (const id of spec.boegen) {
    const b = store.hole(id);
    if (!b) throw new HttpError(404, "Ein ausgewählter Charakterbogen wurde nicht gefunden.");
    const eigen = !!nutzer && b.besitzer_id === nutzer.id;
    const gezielt = !!nutzer && store.istFreigegebenFuer(b.id, nutzer.id);
    if (!eigen && !admin && !gezielt && !(b.oeffentlich && nutzer)) throw new HttpError(403, `Der Charakterbogen „${b.titel}“ ist nicht für dich freigegeben.`);
    if (!b.oeffentlich) privat = true;
    boegen.push({ id: b.id, titel: b.titel, geaendert: b.geaendert });
  }
  const keySrc = JSON.stringify({ v: cfg.templateVersion, t: spec.title, f: spec.fmt, s: sheet?.file ?? null,
    b: boegen.map(b => [b.id, b.geaendert]), p: parts.map(p => [p.name, p.chapters.map(c => [c.wikiTitle, c.revid])]) });
  const key = new Bun.CryptoHasher("sha256").update(keySrc).digest("hex").slice(0, 32);
  return { spec, key, parts, sheetFile: sheet?.file, sheetName: sheet?.name, boegen, privat };
}

export type Progress = (msg: string) => void;

async function assemble(r: Resolved, progress: Progress): Promise<Book> {
  const cat = await loadCatalog();
  const bookTitles = new Map<string, string>();
  for (const p of r.parts) for (const c of p.chapters) bookTitles.set(c.wikiTitle.toLowerCase(), c.id);
  const parts: Part[] = [];
  let i = 0; const total = r.parts.reduce((a, p) => a + p.chapters.length, 0);
  for (const p of r.parts) {
    const chapters: Chapter[] = [];
    for (const c of p.chapters) {
      progress(`Hole Seite ${++i} von ${total}: ${c.title}`);
      const parsed = await parseRevision(c.revid);
      const title = parsed.displaytitle ? stripTags(parsed.displaytitle) : c.title;
      chapters.push(await cleanChapter(parsed.html, { ...c, title: title.replace(/^Kategorie:/, "") }, bookTitles, cat.badgeFiles));
    }
    parts.push({ id: `p-${p.id}`, name: p.name, chapters });
  }
  return { title: r.spec.title, fmt: r.spec.fmt, parts, sheetName: r.sheetName, created: new Date() };
}

export async function debugHtml(spec: BookSpec): Promise<string> {
  return buildDocument(await assemble(await resolve(spec), () => {}));
}

export async function buildBook(r: Resolved, progress: Progress = () => {}): Promise<{ path: string; cached: boolean }> {
  const hit = await cacheGet(r.key);
  if (hit) return { path: hit, cached: true };
  const cat = await loadCatalog();
  const book = await assemble(r, progress);
  const total = book.parts.reduce((a, p) => a + p.chapters.length, 0);
  progress("Setze das Buch …");
  const html = buildDocument(book);
  const res = await renderPdf(html);
  console.log(`Render: ${res.pages} Seiten in ${res.ms} ms (${r.spec.fmt}, ${total} Kapitel)`);
  let sheet: Uint8Array | undefined;
  if (r.sheetFile) { progress("Hänge leeren Charakterbogen an …"); sheet = await fetchFile(r.sheetFile); }
  const boegenPdf: Uint8Array[] = [];
  if (r.boegen.length) {
    const store = await import("./store");
    const { bogenPdf } = await import("./sheet");
    for (const b of r.boegen) {
      progress(`Charakterbogen „${b.titel}" wird gesetzt …`);
      const roh = store.hole(b.id);
      if (!roh) continue;
      const p = store.holePortrait(b.id);
      const design = cat.sheets.find((s) => s.id === roh.design) ?? cat.sheets[0];
      boegenPdf.push(await bogenPdf(JSON.parse(roh.daten), design, p?.portrait ? { bytes: p.portrait, typ: p.portrait_typ ?? "image/png" } : null));
    }
  }
  const final = await finalizeBook(res.pdf, { title: r.spec.title, sheet, sheetName: r.sheetFile, boegen: boegenPdf });
  const path = await cachePut(r.key, final);
  return { path, cached: false };
}

const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, "")).trim();

export function fileName(spec: BookSpec): string {
  const base = spec.title.replace(/[^\p{L}\p{N} _.-]+/gu, "").replace(/\s+/g, "_").slice(0, 60) || "HTBAH";
  return `HTBAH_${base}_${spec.fmt.toUpperCase()}.pdf`;
}

export { resolvedCatalog };
