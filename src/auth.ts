import { cfg } from "./config";

export interface Nutzer { id: number; name: string; gruppen: string[]; rechte: string[] }

const cache = new Map<string, { at: number; nutzer: Nutzer | null }>();
const TTL = 60_000;

/** Nur die Cookies weiterreichen, die MediaWiki selbst gesetzt hat. */
function wikiCookies(header: string | null): string | null {
  if (!header) return null;
  const teile = header.split(/;\s*/).filter((c) => /^[A-Za-z0-9_]*(session|UserID|UserName|Token|LoggedOut)/i.test(c.split("=")[0] ?? ""));
  return teile.length ? teile.join("; ") : null;
}

/** Wer ist angemeldet? Die Sitzung prüft das Wiki selbst, wir reichen nur die Cookies durch. */
export async function nutzerVonRequest(req: Request): Promise<Nutzer | null> {
  const cookie = wikiCookies(req.headers.get("cookie"));
  if (!cookie) return null;
  const key = new Bun.CryptoHasher("sha256").update(cookie).digest("hex");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.nutzer;
  let nutzer: Nutzer | null = null;
  try {
    const u = new URL(cfg.wikiApi);
    u.searchParams.set("action", "query");
    u.searchParams.set("meta", "userinfo");
    u.searchParams.set("uiprop", "groups|rights");
    u.searchParams.set("format", "json");
    u.searchParams.set("formatversion", "2");
    const r = await fetch(u, { headers: { Host: cfg.wikiHost, Cookie: cookie, "User-Agent": "HTBAH-WikiToPdf/2.0" } });
    if (r.ok) {
      const info = (await r.json())?.query?.userinfo;
      if (info && !info.anon && info.id > 0) nutzer = { id: info.id, name: info.name, gruppen: info.groups ?? [], rechte: info.rights ?? [] };
    }
  } catch (e) {
    console.warn("Anmeldeprüfung fehlgeschlagen:", String(e));
  }
  cache.set(key, { at: Date.now(), nutzer });
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > TTL) cache.delete(k);
  return nutzer;
}

export const istAdmin = (n: Nutzer | null) => !!n && (n.gruppen.includes("sysop") || n.gruppen.includes("bureaucrat"));

/** Sichten darf, wer im Wiki Versionen freigeben darf – das sind die Redakteure. */
export const istRedakteur = (n: Nutzer | null) =>
  !!n && (istAdmin(n) || n.rechte.includes("approverevisions") || n.gruppen.includes("Redakteure"));

/** Schreibzugriffe nur aus dem eigenen Wiki heraus, nicht von fremden Seiten. */
export function csrfOk(req: Request): boolean {
  if (req.headers.get("x-htbah") !== "1") return false;
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "same-site" || site === "none";
}
