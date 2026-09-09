import { cfg } from "./config";
import { nutzerVonRequest, istAdmin, csrfOk, type Nutzer } from "./auth";
import * as store from "./store";
import { bogenPdf } from "./sheet";
import { loadCatalog } from "./catalog";
import { nutzerIds } from "./wiki";
import { berechne } from "../public/rules.js";
import { HttpError } from "./book";

const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const STEUERZEICHEN = new RegExp("[\\u0000-\\u001f\\u007f]", "g");
const kurz = (v: unknown, max: number) => String(v ?? "").replace(STEUERZEICHEN, "").slice(0, max);

/** Nur bekannte Felder übernehmen und Längen begrenzen. */
function saubereDaten(roh: any) {
  const gruppe = (liste: any) => (Array.isArray(liste) ? liste : []).slice(0, 10)
    .map((f: any) => ({ n: kurz(f?.n, 60), p: Math.max(0, Math.min(999, Math.floor(Number(f?.p) || 0))) }))
    .filter((f) => f.n || f.p);
  return {
    v: 1,
    name: kurz(roh?.name, 60), geschlecht: kurz(roh?.geschlecht, 40), alter: kurz(roh?.alter, 12),
    statur: kurz(roh?.statur, 40), religion: kurz(roh?.religion, 40), beruf: kurz(roh?.beruf, 60),
    familienstand: kurz(roh?.familienstand, 40), lebenspunkte: kurz(roh?.lebenspunkte, 8),
    inventar: kurz(roh?.inventar, 900), anmerkungen: kurz(roh?.anmerkungen, 900),
    handeln: gruppe(roh?.handeln), wissen: gruppe(roh?.wissen), soziales: gruppe(roh?.soziales),
  };
}

function portraitAusDataUrl(dataUrl: unknown): { bytes: Uint8Array; typ: string } | null {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, "Portrait muss ein PNG oder JPEG sein.");
  const bytes = Uint8Array.from(Buffer.from(m[2], "base64"));
  if (bytes.length > store.MAX_PORTRAIT) throw new HttpError(413, "Das Portrait ist zu groß (höchstens 500 KB).");
  return { bytes, typ: m[1] };
}

const ansicht = (b: any, mit: Nutzer | null) => {
  const eigener = !!mit && b.besitzer_id === mit.id;
  return {
    id: b.id, titel: b.titel, design: b.design, besitzer: b.besitzer_name, eigener,
    freigegeben: !!b.freigegeben, hatPortrait: !!b.hat_portrait || !!b.portrait, geaendert: b.geaendert,
    freigabeNamen: eigener || istAdmin(mit) ? store.freigabenVon(b.id).map((f) => f.nutzer_name) : undefined,
  };
};

async function sheetVon(design: string) {
  const cat = await loadCatalog();
  const s = cat.sheets.find((x) => x.id === design);
  if (!s) throw new HttpError(400, `Unbekanntes Bogendesign: ${design}`);
  return s;
}

/** Eigene Bögen immer, gezielt freigegebene für die genannten Nutzer, „für alle" für Angemeldete. */
function darfSehen(b: store.Bogen, n: Nutzer | null) {
  if (!n) return false;
  if (b.besitzer_id === n.id || istAdmin(n)) return true;
  if (b.freigegeben) return true;
  return store.istFreigegebenFuer(b.id, n.id);
}

function dateiname(titel: string) {
  const rein = (titel || "Charakterbogen").replace(/[^\p{L}\p{N} _.-]+/gu, "").replace(/\s+/g, "_").slice(0, 60);
  return `HTBAH_${rein || "Charakterbogen"}.pdf`;
}

export async function sheetRoutes(path: string, req: Request, url: URL): Promise<Response | null> {
  // Interne Schnittstelle für das Wiki (DSGVO): Löschen und Auskunft
  if (path.startsWith("/api/internal/")) {
    if (!cfg.internalToken || req.headers.get("x-htbah-token") !== cfg.internalToken) return json({ error: "nicht erlaubt" }, 403);
    const uid = Number(url.searchParams.get("userId") ?? 0);
    if (!uid) return json({ error: "userId fehlt" }, 400);
    if (path === "/api/internal/vanish" && req.method === "POST") {
      const weg = store.loescheVonNutzer(uid);
      const { pruneAll } = await import("./cache");
      await pruneAll();
      return json({ geloescht: weg });
    }
    if (path === "/api/internal/export") {
      const liste = store.eigene(uid).map((b) => ({ ...ansicht(b, null), daten: JSON.parse(b.daten) }));
      return json({ charakterboegen: liste });
    }
    return json({ error: "unbekannt" }, 404);
  }

  const nutzer = await nutzerVonRequest(req);

  if (path === "/api/me") {
    return json({
      angemeldet: !!nutzer, name: nutzer?.name ?? null, admin: istAdmin(nutzer),
      anmeldelink: `${cfg.publicWiki}/index.php?title=Spezial:Anmelden`, wiki: cfg.publicWiki,
      grenzen: { proNutzer: store.MAX_PRO_NUTZER, portraitKb: Math.round(store.MAX_PORTRAIT / 1024) },
    });
  }

  if (path === "/api/boegen" && req.method === "GET") {
    if (!nutzer) return json({ eigene: [], fuerMich: [], freigegeben: [] });
    const meine = new Set(store.eigene(nutzer.id).map((b) => b.id));
    const fuerMich = store.fuerMich(nutzer.id).filter((b) => !meine.has(b.id));
    const gezielt = new Set(fuerMich.map((b) => b.id));
    return json({
      eigene: store.eigene(nutzer.id).map((b) => ansicht(b, nutzer)),
      fuerMich: fuerMich.map((b) => ansicht(b, nutzer)),
      freigegeben: store.freigegebene().filter((b) => !meine.has(b.id) && !gezielt.has(b.id)).map((b) => ansicht(b, nutzer)),
    });
  }

  if (path === "/api/boegen" && req.method === "POST") {
    if (!nutzer) return json({ error: "Zum Speichern musst du im Wiki angemeldet sein." }, 401);
    if (!csrfOk(req)) return json({ error: "Ungültige Anfrage." }, 403);
    const body = await req.json().catch(() => null) as any;
    if (!body) return json({ error: "Kein gültiger Inhalt." }, 400);
    const daten = saubereDaten(body.daten);
    const alsText = JSON.stringify(daten);
    if (alsText.length > store.MAX_DATEN) return json({ error: "Der Bogen ist zu umfangreich." }, 413);
    const design = kurz(body.design, 40) || "standard";
    await sheetVon(design);
    let id = kurz(body.id, 24);
    let erstellt: string | undefined;
    let portraitSetzen = false;
    let portrait: { bytes: Uint8Array; typ: string } | null = null;
    if (id) {
      const alt = store.hole(id);
      if (!alt) return json({ error: "Bogen nicht gefunden." }, 404);
      if (alt.besitzer_id !== nutzer.id && !istAdmin(nutzer)) return json({ error: "Das ist nicht dein Bogen." }, 403);
      erstellt = alt.erstellt;
      if (body.portrait !== undefined) { portraitSetzen = true; portrait = body.portrait ? portraitAusDataUrl(body.portrait) : null; }
    } else {
      if (store.anzahlVon(nutzer.id) >= store.MAX_PRO_NUTZER)
        return json({ error: `Mehr als ${store.MAX_PRO_NUTZER} Bögen gehen nicht. Lösche einen alten.` }, 409);
      id = store.neueId();
      portraitSetzen = true;
      portrait = body.portrait ? portraitAusDataUrl(body.portrait) : null;
    }
    let freigabeFehlend: string[] = [];
    if (Array.isArray(body.freigabeNamen)) {
      const { gefunden, fehlend } = await nutzerIds(body.freigabeNamen.map((x: any) => kurz(x, 80)));
      freigabeFehlend = fehlend;
      store.setzeFreigaben(id, gefunden.filter((g) => g.nutzer_id !== nutzer.id));
    }
    const gespeichert = store.speichere({
      id, besitzer_id: nutzer.id, besitzer_name: nutzer.name,
      titel: kurz(body.titel, 80) || daten.name || "Namenloser Held", design, daten: alsText,
      freigegeben: body.freigegeben ? 1 : 0, erstellt,
      portrait: portrait?.bytes ?? null, portrait_typ: portrait?.typ ?? null,
    }, portraitSetzen);
    return json({ bogen: ansicht(gespeichert, nutzer), unbekannteNutzer: freigabeFehlend });
  }

  const m = path.match(/^\/api\/boegen\/([A-Za-z0-9]{4,24})(\/pdf|\/portrait|\/loeschen)?$/);
  if (m) {
    const b = store.hole(m[1]);
    if (!b) return json({ error: "Bogen nicht gefunden." }, 404);
    const aktion = m[2];
    if (aktion === "/loeschen") {
      if (req.method !== "POST") return json({ error: "Falsche Methode." }, 405);
      if (!nutzer || (b.besitzer_id !== nutzer.id && !istAdmin(nutzer))) return json({ error: "Nicht erlaubt." }, 403);
      if (!csrfOk(req)) return json({ error: "Ungültige Anfrage." }, 403);
      store.loesche(b.id);
      return json({ ok: true });
    }
    if (!darfSehen(b, nutzer)) return json({ error: "Dieser Bogen ist nicht freigegeben." }, 403);
    if (aktion === "/portrait") {
      const p = store.holePortrait(b.id);
      if (!p?.portrait) return new Response("kein Portrait", { status: 404 });
      return new Response(p.portrait as unknown as BodyInit, { headers: { "content-type": p.portrait_typ ?? "image/png", "cache-control": "private, max-age=300" } });
    }
    if (aktion === "/pdf") {
      const daten = JSON.parse(b.daten);
      const p = store.holePortrait(b.id);
      const pdf = await bogenPdf(daten, await sheetVon(b.design), p?.portrait ? { bytes: p.portrait, typ: p.portrait_typ ?? "image/png" } : null);
      return new Response(pdf as unknown as BodyInit, { headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(dateiname(b.titel))}`,
        "cache-control": "private, no-store" } });
    }
    return json({ bogen: { ...ansicht(b, nutzer), daten: JSON.parse(b.daten) } });
  }

  // Ungespeicherten Bogen sofort als PDF, auch ohne Anmeldung
  if (path === "/api/bogen/pdf" && req.method === "POST") {
    if (!csrfOk(req)) return json({ error: "Ungültige Anfrage." }, 403);
    const body = await req.json().catch(() => null) as any;
    if (!body) return json({ error: "Kein gültiger Inhalt." }, 400);
    const daten = saubereDaten(body.daten);
    const portrait = body.portrait ? portraitAusDataUrl(body.portrait) : null;
    const pdf = await bogenPdf(daten, await sheetVon(kurz(body.design, 40) || "standard"), portrait);
    return new Response(pdf as unknown as BodyInit, { headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(dateiname(daten.name))}`,
      "cache-control": "no-store" } });
  }

  if (path === "/api/bogen/pruefen" && req.method === "POST") {
    const body = await req.json().catch(() => null) as any;
    return json({ werte: berechne(saubereDaten(body?.daten)) });
  }
  return null;
}
