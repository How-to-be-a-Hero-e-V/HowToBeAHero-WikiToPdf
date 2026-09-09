import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { join } from "node:path";
import { berechne, restText, GRUPPEN, GRUPPEN_LABEL, MAX_ZEILEN, type Gruppe as RGruppe } from "../public/rules.js";
import { fetchFile } from "./wiki";
import type { Sheet } from "./catalog";

export interface Rect { x: number; y: number; w: number; h: number }
interface GruppenLayout { wert?: Rect; gbp?: Rect; bonus?: Rect[]; zeilen: { name: Rect; punkte?: Rect; wert: Rect }[] }
export interface Layout {
  breite: number; hoehe: number;
  kopf: Record<string, Rect>;
  gruppen: Record<string, GruppenLayout>;
  inventar: Rect; anmerkungen: Rect; portrait?: Rect;
  rest?: Rect; fuss?: Rect;
}

const fontDir = join(import.meta.dir, "..", "template", "fonts", "Open_Sans");
const regularBytes = await Bun.file(join(fontDir, "OpenSans-Regular.ttf")).arrayBuffer();
const boldBytes = await Bun.file(join(fontDir, "OpenSans-SemiBold.ttf")).arrayBuffer();

// ---------------------------------------------------------------- Layouts

const OFFIZIELL_FELDER: Record<string, string> = {
  name: "Name", geschlecht: "Geschlecht", alter: "Alter", lebenspunkte: "Lebenspunkte",
  statur: "Statur", religion: "Religion", beruf: "Beruf", familienstand: "Familienstand",
};
const OFFIZIELL_GRUPPEN: Record<string, { wert: string; gbp: string; bonus: string; name: (i: number) => string; punkte: (i: number) => string; endwert: (i: number) => string }> = {
  handeln: { wert: "Handeln", gbp: "Geistesblitzpunkte_Handeln", bonus: "HGB", name: (i) => `HTalent.${i}`, punkte: (i) => `HG${i}`, endwert: (i) => `HGG${i}` },
  wissen: { wert: "Wissen", gbp: "Geistesblitzpunkte_Wissen", bonus: "WGB", name: (i) => `WTalent.1.${i}`, punkte: (i) => `WG${i}`, endwert: (i) => `WGG${i}` },
  soziales: { wert: "Interagieren", gbp: "GBPI", bonus: "IFB", name: (i) => `ITalent.${i}`, punkte: (i) => `INF${i}`, endwert: (i) => `IFG${i}` },
};

/** Layout aus den Formularfeldern der Vorlage lesen (offizielle Bögen). */
function layoutAusFormular(doc: PDFDocument): Layout | null {
  let form;
  try { form = doc.getForm(); } catch { return null; }
  const rects = new Map<string, Rect[]>();
  for (const f of form.getFields()) {
    const list = f.acroField.getWidgets().map((w) => { const r = w.getRectangle(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    if (list.length) rects.set(f.getName(), list);
  }
  if (!rects.has("HTalent.1") || !rects.has("Name")) return null;
  const one = (n: string) => rects.get(n)?.[0];
  const page = doc.getPage(0);
  const kopf: Record<string, Rect> = {};
  for (const [k, feld] of Object.entries(OFFIZIELL_FELDER)) { const r = one(feld); if (r) kopf[k] = r; }
  const gruppen: Record<string, GruppenLayout> = {};
  for (const [g, map] of Object.entries(OFFIZIELL_GRUPPEN)) {
    const zeilen = [];
    for (let i = 1; i <= MAX_ZEILEN; i++) {
      const name = one(map.name(i)), punkte = one(map.punkte(i)), wert = one(map.endwert(i));
      if (name && wert) zeilen.push({ name, punkte, wert });
    }
    gruppen[g] = { wert: one(map.wert)!, gbp: one(map.gbp), bonus: rects.get(map.bonus), zeilen };
  }
  return {
    breite: page.getWidth(), hoehe: page.getHeight(), kopf, gruppen,
    inventar: one("Inventar")!, anmerkungen: one("Anmerkungen")!, rest: one("PunkteRest"),
    portrait: one("Portrait_af_image"),
  };
}

/** Gemessenes Layout der Setting-Bögen (Dysomnia, Der Schwarze Tod) – gleiche Geometrie. */
const ZEILEN_Y = [360, 385, 410, 435, 460, 486, 511, 536, 561, 586];
const SPALTEN = { handeln: { name: 36, wert: 167.5 }, wissen: { name: 217, wert: 350 }, soziales: { name: 400, wert: 532.5 } };

function layoutSetting(hoehe = 842, breite = 595): Layout {
  const box = (x: number, yTop: number, w: number, h: number): Rect => ({ x, y: hoehe - yTop - h, w, h });
  // Kopffelder tragen ihre Beschriftung oben im Kasten, daher unten einsetzen
  const feld = (x: number, yTop: number, w: number, h: number) => box(x + 5, yTop + 15, w - 10, h - 18);
  const gruppen: Record<string, GruppenLayout> = {};
  for (const g of GRUPPEN) {
    const s = SPALTEN[g as keyof typeof SPALTEN];
    gruppen[g] = {
      // Kopfkasten traegt Schriftzug und Symbol, der Begabungswert steht in der Zeile darueber
      zeilen: ZEILEN_Y.map((y) => ({
        name: box(s.name + 4, y + 3, s.wert - s.name - 10, 16),
        wert: box(s.wert + 1, y + 3, 20, 16),
      })),
    };
  }
  return {
    breite, hoehe,
    kopf: {
      name: feld(37, 85, 339, 42), geschlecht: feld(37, 145, 165, 42), alter: feld(217, 146, 71, 42),
      lebenspunkte: feld(292, 146, 86, 42), statur: feld(37, 193, 165, 42), religion: feld(217, 193, 162, 42),
      beruf: feld(37, 241, 165, 42), familienstand: feld(217, 241, 162, 42),
    },
    gruppen,
    inventar: box(42, 650, 241, 120), anmerkungen: box(313, 650, 241, 120), portrait: box(401, 86, 157, 193),
    fuss: box(37, 286, 522, 14),
  };
}

const layoutCache = new Map<string, { layout: Layout; bytes: Uint8Array }>();

export async function ladeVorlage(sheet: Sheet): Promise<{ layout: Layout; bytes: Uint8Array }> {
  const key = sheet.file;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const bytes = await fetchFile(sheet.file);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = doc.getPage(0);
  const layout = layoutAusFormular(doc) ?? layoutSetting(page.getHeight(), page.getWidth());
  const eintrag = { layout, bytes };
  layoutCache.set(key, eintrag);
  return eintrag;
}

// ---------------------------------------------------------------- Zeichnen

const TINTE = rgb(0.06, 0.06, 0.12);
const GRAU = rgb(0.45, 0.45, 0.52);

function schreibe(page: PDFPage, r: Rect | undefined, text: string, o: { font: PDFFont; size?: number; center?: boolean; color?: any; max?: number } ) {
  if (!r || !text) return;
  let s = o.size ?? Math.min(o.max ?? 11, r.h - 4);
  let w = o.font.widthOfTextAtSize(text, s);
  while (w > r.w - 5 && s > 4.5) { s -= 0.25; w = o.font.widthOfTextAtSize(text, s); }
  const x = o.center ? r.x + (r.w - w) / 2 : r.x + 3;
  const y = r.y + (r.h - o.font.heightAtSize(s, { descender: false })) / 2 + 0.5;
  page.drawText(text, { x, y, size: s, font: o.font, color: o.color ?? TINTE });
}

function umbrich(text: string, font: PDFFont, size: number, breite: number): string[] {
  const zeilen: string[] = [];
  for (const absatz of text.split(/\r?\n/)) {
    let aktuell = "";
    for (const wort of absatz.split(/\s+/)) {
      const test = aktuell ? `${aktuell} ${wort}` : wort;
      if (font.widthOfTextAtSize(test, size) > breite && aktuell) { zeilen.push(aktuell); aktuell = wort; }
      else aktuell = test;
    }
    zeilen.push(aktuell);
  }
  return zeilen;
}

function block(page: PDFPage, r: Rect, text: string, font: PDFFont, size = 9) {
  if (!text) return;
  const zeilen = umbrich(text, font, size, r.w - 8);
  const hoehe = size * 1.35;
  const max = Math.floor(r.h / hoehe);
  zeilen.slice(0, max).forEach((z, i) => page.drawText(z, { x: r.x + 4, y: r.y + r.h - hoehe * (i + 1) + size * 0.3, size, font, color: TINTE }));
}

/** Füllt eine Bogenvorlage mit den Werten eines Charakters und gibt das PDF zurück. */
export async function bogenPdf(ch: any, sheet: Sheet, portrait?: { bytes: Uint8Array; typ: string } | null): Promise<Uint8Array> {
  const { layout, bytes } = await ladeVorlage(sheet);
  const werte = berechne(ch);
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const [vorlage] = await out.embedPdf(bytes);
  const page = out.addPage([layout.breite, layout.hoehe]);
  page.drawPage(vorlage, { x: 0, y: 0, width: layout.breite, height: layout.hoehe });
  const font = await out.embedFont(regularBytes, { subset: true });
  const bold = await out.embedFont(boldBytes, { subset: true });

  for (const [k, r] of Object.entries(layout.kopf)) {
    const text = String(ch[k] ?? "").trim();
    const zentriert = k === "alter" || k === "lebenspunkte";
    schreibe(page, r, text, { font, center: zentriert, max: k === "name" ? 14 : 11 });
  }
  for (const g of GRUPPEN) {
    const gl = layout.gruppen[g]; const w = werte.gruppen[g];
    if (!gl) continue;
    schreibe(page, gl.wert, String(w.begabung), { font: bold, center: true, max: 15 });
    schreibe(page, gl.gbp, String(w.gbp), { font: bold, center: true, max: 12 });
    w.zeilen.slice(0, gl.zeilen.length).forEach((z: { n: string; p: number; wert: number }, i: number) => {
      const zl = gl.zeilen[i];
      schreibe(page, zl.name, z.n, { font, max: 10 });
      schreibe(page, zl.punkte, String(z.p), { font, center: true, max: 10 });
      schreibe(page, zl.wert, String(z.wert), { font: bold, center: true, max: 10 });
      const bonus = gl.bonus?.[i];
      if (bonus && zl.punkte) schreibe(page, bonus, `+${w.begabung}`, { font, center: true, size: 6.5, color: GRAU });
    });
  }
  if (portrait?.bytes?.length && layout.portrait) {
    try {
      const bild = portrait.typ === "image/jpeg" ? await out.embedJpg(portrait.bytes) : await out.embedPng(portrait.bytes);
      const r = layout.portrait;
      const skal = Math.min(r.w / bild.width, r.h / bild.height);      // vollständig sichtbar, Seitenverhältnis erhalten
      const w = bild.width * skal, h = bild.height * skal;
      page.drawImage(bild, { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, width: w, height: h });
    } catch (e) { console.warn("Portrait konnte nicht eingebettet werden:", String(e)); }
  }
  block(page, layout.inventar, String(ch.inventar ?? ""), font);
  block(page, layout.anmerkungen, String(ch.anmerkungen ?? ""), font);
  schreibe(page, layout.rest, restText(werte.rest), { font, center: true, max: 9, color: GRAU });
  if (layout.fuss) {
    const beg = GRUPPEN.map((g: RGruppe) => `${GRUPPEN_LABEL[g]} ${werte.gruppen[g].begabung}`).join(" · ");
    const gbp = GRUPPEN.map((g: RGruppe) => werte.gruppen[g].gbp).join(" · ");
    schreibe(page, layout.fuss, `Begabungen: ${beg}   —   Geistesblitzpunkte: ${gbp}   —   ${restText(werte.rest)}`, { font: bold, size: 8.5, color: TINTE });
  }
  out.setTitle(`${ch.name || "Charakterbogen"} – How to be a Hero`);
  out.setCreator("howtobeahero.de");
  out.setProducer("HTBAH WikiToPdf 2");
  return out.save();
}
