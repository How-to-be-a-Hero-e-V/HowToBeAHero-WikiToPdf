/**
 * Macht die Setting-Charakterbögen (Dysomnia, Der Schwarze Tod) ausfüllbar:
 * legt Formularfelder mit denselben Namen wie im offiziellen Bogen an und
 * beschriftet den freien Streifen über den Gruppen für Begabung und Geistesblitz.
 *
 * Aufruf: bun run tools/make_fillable.ts <quelle.pdf> <ziel.pdf>
 */
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { join } from "node:path";

const [quelle, ziel] = process.argv.slice(2);
if (!quelle || !ziel) { console.error("Aufruf: bun run tools/make_fillable.ts <quelle.pdf> <ziel.pdf>"); process.exit(1); }

const ZEILEN_Y = [360, 385, 410, 435, 460, 486, 511, 536, 561, 586];
const SPALTEN = {
  handeln: { name: 36, wert: 167.5, label: "Handeln", felder: { name: (i: number) => `HTalent.${i}`, wert: (i: number) => `HGG${i}` }, beg: "Handeln", gbp: "Geistesblitzpunkte_Handeln" },
  wissen: { name: 217, wert: 350, label: "Wissen", felder: { name: (i: number) => `WTalent.1.${i}`, wert: (i: number) => `WGG${i}` }, beg: "Wissen", gbp: "Geistesblitzpunkte_Wissen" },
  soziales: { name: 400, wert: 532.5, label: "Soziales", felder: { name: (i: number) => `ITalent.${i}`, wert: (i: number) => `IFG${i}` }, beg: "Interagieren", gbp: "GBPI" },
};

const src = await Bun.file(quelle).arrayBuffer();
const alt = await PDFDocument.load(src, { ignoreEncryption: true });
const seite = alt.getPage(0);
const B = seite.getWidth(), H = seite.getHeight();

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const [vorlage] = await doc.embedPdf(src);
const page = doc.addPage([B, H]);
page.drawPage(vorlage, { x: 0, y: 0, width: B, height: H });

const fontBytes = await Bun.file(join(import.meta.dir, "..", "template", "fonts", "Open_Sans", "OpenSans-Regular.ttf")).arrayBuffer();
const font = await doc.embedFont(fontBytes, { subset: false });
const form = doc.getForm();
const box = (x: number, yTop: number, w: number, h: number) => ({ x, y: H - yTop - h, width: w, height: h });

function feld(name: string, x: number, yTop: number, w: number, h: number, opt: { size?: number; mehrzeilig?: boolean } = {}) {
  const f = form.createTextField(name);
  if (opt.mehrzeilig) f.enableMultiline();
  f.addToPage(page, { ...box(x, yTop, w, h), borderWidth: 0, backgroundColor: undefined, borderColor: undefined, font });
  f.setFontSize(opt.size ?? 10);
}

// Kopfdaten: Beschriftung steht oben im Kasten, das Feld sitzt darunter
feld("Name", 42, 100, 329, 25, { size: 13 });
feld("Geschlecht", 42, 160, 155, 25);
feld("Alter", 222, 161, 61, 25);
feld("Lebenspunkte", 297, 161, 76, 25);
feld("Statur", 42, 208, 155, 25);
feld("Religion", 222, 208, 152, 25);
feld("Beruf", 42, 256, 155, 25);
feld("Familienstand", 222, 256, 152, 25);
feld("Inventar", 42, 650, 241, 120, { size: 9, mehrzeilig: true });
feld("Anmerkungen", 313, 650, 241, 120, { size: 9, mehrzeilig: true });

// Streifen über den Gruppen: Begabung und Geistesblitzpunkte bekommen hier ihren Platz
const klein = 7.5;
let x = 37;
page.drawText("Begabung / Geistesblitz:", { x, y: H - 298, size: klein, font, color: rgb(0.35, 0.35, 0.42) });
x += font.widthOfTextAtSize("Begabung / Geistesblitz:", klein) + 8;
for (const s of Object.values(SPALTEN)) {
  page.drawText(`${s.label}`, { x, y: H - 298, size: klein, font, color: rgb(0.35, 0.35, 0.42) });
  const nachLabel = x + font.widthOfTextAtSize(s.label, klein) + 3;
  feld(s.beg, nachLabel, 288, 22, 13, { size: 9 });
  page.drawText("/", { x: nachLabel + 24, y: H - 298, size: klein, font, color: rgb(0.35, 0.35, 0.42) });
  feld(s.gbp, nachLabel + 30, 288, 18, 13, { size: 9 });
  x = nachLabel + 56;
}

// Fähigkeitszeilen: Name und Endwert
for (const s of Object.values(SPALTEN)) {
  ZEILEN_Y.forEach((y, i) => {
    feld(s.felder.name(i + 1), s.name + 4, y + 3, s.wert - s.name - 10, 16, { size: 9.5 });
    feld(s.felder.wert(i + 1), s.wert + 1, y + 3, 20, 16, { size: 9.5 });
  });
}

form.updateFieldAppearances(font);
doc.setTitle(alt.getTitle() ?? "How to be a Hero – Charakterbogen");
doc.setProducer("HTBAH WikiToPdf 2");
await Bun.write(ziel, await doc.save());
console.log(`${ziel}: ${form.getFields().length} Felder`);
