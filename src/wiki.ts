import { cfg } from "./config";

// Alle Zugriffe laufen intern gegen den MediaWiki-Container.
const headers = { Host: cfg.wikiHost, "User-Agent": "HTBAH-WikiToPdf/2.0 (+https://howtobeahero.de)" };

async function api<T = any>(params: Record<string, string>): Promise<T> {
  const u = new URL(cfg.wikiApi);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("format", "json");
  u.searchParams.set("formatversion", "2");
  const r = await fetch(u, { headers });
  if (!r.ok) throw new Error(`Wiki-API antwortet mit ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`Wiki-API: ${j.error.info ?? j.error.code}`);
  return j;
}

export interface PageInfo {
  query: string;      // angefragter Titel
  title: string;      // normalisierter Titel (nach Weiterleitung)
  exists: boolean;
  ns: number;
  revid: number;      // freigegebene Revision (ApprovedRevs) oder aktuellste
  approved: boolean;
}

let extApi: boolean | null = null;

// Liefert pro Titel die Revision, die Leser im Wiki sehen. Mit der HTBAH-Extension ist das
// die von ApprovedRevs freigegebene Version, ohne sie die aktuellste. Weiterleitungen werden aufgeloest.
export async function pageInfo(titles: string[]): Promise<PageInfo[]> {
  const out: PageInfo[] = [];
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    if (extApi !== false) {
      try {
        const j = await api({ action: "htbahpdf", titles: chunk.join("|") });
        extApi = true;
        for (const p of j.htbahpdf.pages) out.push({ query: p.query, title: p.title ?? p.query, exists: !!p.exists && !p.invalid, ns: p.ns ?? 0, revid: p.revid ?? 0, approved: !!p.approved });
        continue;
      } catch (e) {
        // Nur "Modul unbekannt" ist dauerhaft; alles andere (Wiki gerade nicht erreichbar) weiterreichen
        if (/Unrecognized value for parameter "action"/.test(String(e))) { if (extApi === null) console.warn("htbahpdf-API nicht verfuegbar, nutze aktuellste Revisionen"); extApi = false; }
        else throw e;
      }
    }
    const j = await api({ action: "query", prop: "info", titles: chunk.join("|"), redirects: "1" });
    const map = new Map<string, string>(); // angefragt -> endgueltiger Titel
    for (const n of j.query.normalized ?? []) map.set(n.from, n.to);
    const redir = new Map<string, string>();
    for (const r of j.query.redirects ?? []) redir.set(r.from, r.to);
    const byTitle = new Map<string, any>((j.query.pages ?? []).map((p: any) => [p.title, p]));
    for (const q of chunk) {
      let t = map.get(q) ?? q; t = redir.get(t) ?? t;
      const p = byTitle.get(t);
      out.push({ query: q, title: t, exists: !!p && !p.missing && !p.invalid, ns: p?.ns ?? 0, revid: p?.lastrevid ?? 0, approved: false });
    }
  }
  return out;
}

export interface Parsed { html: string; displaytitle: string; revid: number; categories: string[] }

export async function parseRevision(revid: number): Promise<Parsed> {
  const j = await api({
    action: "parse", oldid: String(revid), prop: "text|displaytitle|revid|categories",
    disableeditsection: "1", disabletoc: "1", disablelimitreport: "1",
  });
  const p = j.parse;
  return { html: p.text, displaytitle: p.displaytitle, revid: p.revid, categories: (p.categories ?? []).map((c: any) => c.category) };
}

export async function categoryMembers(category: string, type: "page" | "subcat" = "page"): Promise<{ title: string; ns: number }[]> {
  const out: { title: string; ns: number }[] = [];
  let cont: string | undefined;
  do {
    const params: Record<string, string> = {
      action: "query", list: "categorymembers", cmtitle: category.startsWith("Kategorie:") || category.startsWith("Category:") ? category : `Kategorie:${category}`,
      cmtype: type, cmlimit: "500", cmprop: "title",
    };
    if (cont) params.cmcontinue = cont;
    const j = await api(params);
    for (const m of j.query.categorymembers) out.push({ title: m.title, ns: m.ns });
    cont = j.continue?.cmcontinue;
  } while (cont);
  return out;
}

// Erzeugt (falls noetig) Thumbnails in der gewuenschten Breite und liefert interne URLs je Dateiname.
export async function thumbUrls(names: string[], width: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < names.length; i += 50) {
    const chunk = names.slice(i, i + 50);
    try {
      const j = await api({ action: "query", prop: "imageinfo", iiprop: "url", iiurlwidth: String(width), titles: chunk.map(n => `Datei:${n}`).join("|") });
      for (const p of j.query.pages ?? []) {
        const ii = p.imageinfo?.[0];
        if (ii?.thumburl && ii.thumbwidth && ii.thumbwidth <= width) out.set(p.title.replace(/^[^:]+:/, "").replace(/ /g, "_"), toInternal(ii.thumburl));
      }
    } catch (e) { console.warn("Thumbnail-Abfrage fehlgeschlagen:", String(e)); }
  }
  return out;
}

/** Wiki-Benutzernamen zu IDs auflösen; unbekannte Namen kommen als fehlend zurück. */
export async function nutzerIds(namen: string[]): Promise<{ gefunden: { nutzer_id: number; nutzer_name: string }[]; fehlend: string[] }> {
  const sauber = [...new Set(namen.map((n) => n.trim()).filter(Boolean))].slice(0, 30);
  if (!sauber.length) return { gefunden: [], fehlend: [] };
  const j = await api({ action: "query", list: "users", ususers: sauber.join("|") });
  const gefunden: { nutzer_id: number; nutzer_name: string }[] = [];
  const fehlend: string[] = [];
  for (const u of j.query?.users ?? []) {
    if (u.userid && !u.missing && !u.invalid) gefunden.push({ nutzer_id: u.userid, nutzer_name: u.name });
    else fehlend.push(u.name ?? u.user ?? "?");
  }
  return { gefunden, fehlend };
}

export async function rawPage(title: string): Promise<string | null> {
  const u = new URL(cfg.wikiIndex);
  u.searchParams.set("title", title);
  u.searchParams.set("action", "raw");
  const r = await fetch(u, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`action=raw ${r.status} fuer ${title}`);
  return r.text();
}

export async function fetchFile(name: string): Promise<Uint8Array> {
  const j = await api({ action: "query", prop: "imageinfo", iiprop: "url", titles: `Datei:${name}` });
  const p = j.query.pages[0];
  const url: string | undefined = p?.imageinfo?.[0]?.url;
  if (!url) throw new Error(`Datei nicht gefunden: ${name}`);
  const r = await fetch(toInternal(url), { headers });
  if (!r.ok) throw new Error(`Datei ${name}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Oeffentliche Wiki-URL -> interne Container-URL (Bilder laden ohne Umweg uebers Internet)
export function toInternal(url: string): string {
  const base = new URL(cfg.wikiIndex);
  return url.replace(new RegExp(`^${cfg.publicWiki.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `${base.protocol}//${base.host}`);
}

export function pageUrl(title: string, revid?: number): string {
  const u = new URL(cfg.publicWiki + "/index.php");
  u.searchParams.set("title", title);
  if (revid) u.searchParams.set("oldid", String(revid));
  return u.toString();
}
