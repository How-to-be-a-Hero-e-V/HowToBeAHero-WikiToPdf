/**
 * Macht Marcels Setting-Charakterbögen ausfüllbar und rechnend wie den offiziellen Bogen.
 * Die Seite selbst bleibt unverändert, es kommen nur Formularfelder hinzu. So zeichnet der
 * Editor weiter auf die Originalgrafik (er übernimmt keine Felder) und nichts doppelt sich.
 *
 * Pro Fähigkeitszeile: Name, ein neues Kästchen für die Fähigkeitspunkte und Marcels
 * Kästchen, in dem der Endwert (Punkte + Begabung, höchstens 100) berechnet wird.
 * Über den Gruppen: Begabung und Geistesblitzpunkte je Gruppe, rechts die übrigen Punkte.
 *
 * Aufruf: bun run tools/make_fillable.ts <quelle.pdf> <ziel.pdf>
 */
import { PDFDocument, PDFName, PDFHexString, PDFString, PDFArray, PDFBool, PDFDict, rgb, TextAlignment, type PDFTextField, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { join } from "node:path";

const [quelle, ziel] = process.argv.slice(2);
if (!quelle || !ziel) { console.error("Aufruf: bun run tools/make_fillable.ts <quelle.pdf> <ziel.pdf>"); process.exit(1); }

const ZEILEN_Y = [360, 385, 410, 435, 460, 486, 511, 536, 561, 586];
const GRUPPEN = [
  { key: "handeln", label: "Handeln", x: 36, wert: 167.5, name: (i: number) => `HTalent.${i}`, punkte: (i: number) => `HG${i}`, endwert: (i: number) => `HGG${i}`, beg: "Handeln", gbp: "Geistesblitzpunkte_Handeln" },
  { key: "wissen", label: "Wissen", x: 217, wert: 350, name: (i: number) => `WTalent.1.${i}`, punkte: (i: number) => `WG${i}`, endwert: (i: number) => `WGG${i}`, beg: "Wissen", gbp: "Geistesblitzpunkte_Wissen" },
  { key: "soziales", label: "Soziales", x: 400, wert: 532.5, name: (i: number) => `ITalent.${i}`, punkte: (i: number) => `INF${i}`, endwert: (i: number) => `IFG${i}`, beg: "Interagieren", gbp: "GBPI" },
];
const ALLE_PUNKTE = GRUPPEN.map((g) => g.punkte(1).replace(/1$/, ""));

// ---------------------------------------------------------------- Skripte (ES3, damit Acrobat sie versteht)
const js = {
  nurZiffern: 'if (!event.willCommit) { event.rc = /^[0-9]*$/.test(event.change); }',
  begabung: (prefix: string) => [
    "var s = 0;",
    "for (var i = 1; i <= 10; i++) {",
    `  var v = parseInt(this.getField("${prefix}" + i).value, 10);`,
    "  if (!isNaN(v) && v > 0) { s += v; }",
    "}",
    'event.value = s > 0 ? Math.round(s / 10) : "";',
  ].join("\n"),
  gbp: (begabungsFeld: string) => [
    `var b = parseInt(this.getField("${begabungsFeld}").value, 10);`,
    'event.value = (!isNaN(b) && b > 0) ? Math.round(b / 10) : "";',
  ].join("\n"),
  endwert: (punkteFeld: string, begabungsFeld: string) => [
    `var p = parseInt(this.getField("${punkteFeld}").value, 10);`,
    `var b = parseInt(this.getField("${begabungsFeld}").value, 10);`,
    "if (isNaN(b)) { b = 0; }",
    'event.value = (!isNaN(p) && p > 0) ? Math.min(100, p + b) : "";',
  ].join("\n"),
  rest: [
    `var gruppen = ${JSON.stringify(ALLE_PUNKTE)};`,
    "var s = 0;",
    "for (var g = 0; g < gruppen.length; g++) {",
    "  for (var i = 1; i <= 10; i++) {",
    "    var v = parseInt(this.getField(gruppen[g] + i).value, 10);",
    "    if (!isNaN(v) && v > 0) { s += v; }",
    "  }",
    "}",
    'event.value = s > 0 ? 400 - s : "";',
  ].join("\n"),
};

// ---------------------------------------------------------------- Dokument
const src = await Bun.file(quelle).arrayBuffer();
const doc = await PDFDocument.load(src, { ignoreEncryption: true });
doc.registerFontkit(fontkit);
const page: PDFPage = doc.getPage(0);
const H = page.getHeight();
const fontDir = join(import.meta.dir, "..", "template", "fonts", "Open_Sans");
const font: PDFFont = await doc.embedFont(await Bun.file(join(fontDir, "OpenSans-Regular.ttf")).arrayBuffer(), { subset: false });
const form = doc.getForm();
const TINTE = rgb(0.06, 0.06, 0.12);
const GRAU = rgb(0.4, 0.4, 0.47);
const RAHMEN = rgb(0.62, 0.62, 0.68);

const box = (x: number, yTop: number, w: number, h: number) => ({ x, y: H - yTop - h, width: w, height: h });

/** JavaScript-Aktion an ein Feld hängen: K = Tastendruck, C = Berechnung. */
function aktion(f: PDFTextField, art: "K" | "C", code: string) {
  const aa = f.acroField.dict.lookupMaybe(PDFName.of("AA"), PDFDict) ?? doc.context.obj({});
  aa.set(PDFName.of(art), doc.context.obj({ Type: "Action", S: "JavaScript", JS: PDFHexString.fromText(code) }));
  f.acroField.dict.set(PDFName.of("AA"), aa);
}

function feld(name: string, x: number, yTop: number, w: number, h: number, o: {
  size?: number; mehrzeilig?: boolean; zentriert?: boolean; nurLesen?: boolean; rahmen?: boolean;
  farbe?: ReturnType<typeof rgb>; wert?: string; hinweis?: string;
} = {}) {
  const f = form.createTextField(name);
  if (o.mehrzeilig) f.enableMultiline();
  f.addToPage(page, {
    ...box(x, yTop, w, h), font, textColor: o.farbe ?? TINTE,
    borderWidth: o.rahmen ? 0.6 : 0, borderColor: o.rahmen ? RAHMEN : undefined, backgroundColor: undefined,
  });
  f.setFontSize(o.size ?? 10);
  if (o.zentriert) f.setAlignment(TextAlignment.Center);
  if (o.wert) f.setText(o.wert);
  if (o.nurLesen) f.enableReadOnly();
  if (o.hinweis) f.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(o.hinweis));
  return f;
}

/** Beschriftung als schreibgeschütztes Feld: gehört nicht zum Seiteninhalt. */
let beschriftungen = 0;
function beschriftung(text: string, x: number, yTop: number, size = 7.5) {
  const w = font.widthOfTextAtSize(text, size) + 5;
  feld(`Beschriftung.${++beschriftungen}`, x, yTop, w, 13, { size, nurLesen: true, farbe: GRAU, wert: text });
  return x + w;
}

// Kopfdaten: die Beschriftung steht oben im Kasten, das Feld sitzt darunter
feld("Name", 42, 100, 329, 25, { size: 13 });
feld("Geschlecht", 42, 160, 155, 25);
feld("Alter", 222, 161, 61, 25, { zentriert: true });
feld("Lebenspunkte", 297, 161, 76, 25, { zentriert: true, wert: "100" });
feld("Statur", 42, 208, 155, 25);
feld("Religion", 222, 208, 152, 25);
feld("Beruf", 42, 256, 155, 25);
feld("Familienstand", 222, 256, 152, 25);
feld("Inventar", 42, 650, 241, 120, { size: 9, mehrzeilig: true });
feld("Anmerkungen", 313, 650, 241, 120, { size: 9, mehrzeilig: true });

// Streifen über den Gruppen: Begabung / Geistesblitzpunkte, rechts die übrigen Punkte
const berechnet: PDFTextField[] = [];
let x = 37;
x = beschriftung("Begabung / Geistesblitz:", x, 287) + 4;
for (const g of GRUPPEN) {
  x = beschriftung(g.label, x, 287);
  berechnet.push(feld(g.beg, x, 287, 20, 13, { size: 9, zentriert: true, nurLesen: true,
    hinweis: `Begabung ${g.label}: Summe der Fähigkeitspunkte geteilt durch 10 (wird berechnet)` }));
  x = beschriftung("/", x + 21, 287);
  berechnet.push(feld(g.gbp, x, 287, 16, 13, { size: 9, zentriert: true, nurLesen: true,
    hinweis: `Geistesblitzpunkte ${g.label}: Begabung geteilt durch 10 (wird berechnet)` }));
  x += 22;
}
const restLabel = "Punkte übrig:";
const restX = 560 - 26 - (font.widthOfTextAtSize(restLabel, 7.5) + 5);
beschriftung(restLabel, restX, 287);
const rest = feld("PunkteRest", 560 - 26, 287, 26, 13, { size: 9, zentriert: true, nurLesen: true,
  hinweis: "400 Fähigkeitspunkte minus die vergebenen (wird berechnet)" });

// Fähigkeitszeilen: Name, Punkte (neues Kästchen), Endwert (Marcels Kästchen)
const endwerte: PDFTextField[] = [];
for (const g of GRUPPEN) {
  ZEILEN_Y.forEach((y, n) => {
    const i = n + 1;
    const punkteX = g.wert - 25;
    feld(g.name(i), g.x + 4, y + 3, punkteX - g.x - 7, 16, { size: 9.5 });
    const p = feld(g.punkte(i), punkteX, y + 2.5, 22, 17, { size: 9, zentriert: true, rahmen: true,
      hinweis: `Fähigkeitspunkte (${g.label})` });
    aktion(p, "K", js.nurZiffern);
    endwerte.push(feld(g.endwert(i), g.wert, y + 3, 22, 16, { size: 8.5, zentriert: true, nurLesen: true,
      hinweis: "Endwert: Fähigkeitspunkte plus Begabung, höchstens 100 (wird berechnet)" }));
  });
}

// Rechenskripte anhängen
for (const g of GRUPPEN) {
  aktion(form.getTextField(g.beg), "C", js.begabung(g.punkte(1).replace(/1$/, "")));
  aktion(form.getTextField(g.gbp), "C", js.gbp(g.beg));
  for (let i = 1; i <= 10; i++) aktion(form.getTextField(g.endwert(i)), "C", js.endwert(g.punkte(i), g.beg));
}
aktion(rest, "C", js.rest);

// Rechenreihenfolge: erst Begabungen, dann Geistesblitz, Endwerte, Rest
const reihenfolge = [
  ...GRUPPEN.map((g) => form.getTextField(g.beg)),
  ...GRUPPEN.map((g) => form.getTextField(g.gbp)),
  ...endwerte,
  rest,
].map((f) => f.acroField.ref);
const acro = doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
acro.set(PDFName.of("CO"), doc.context.obj(reihenfolge));
acro.set(PDFName.of("NeedAppearances"), PDFBool.True);
// Standardschrift fürs Formular: Betrachter bauen damit Feldinhalte beim Tippen und Rechnen neu auf
acro.set(PDFName.of("DR"), doc.context.obj({ Font: { [font.name]: font.ref } }));
acro.set(PDFName.of("DA"), PDFString.of(`/${font.name} 9 Tf 0 g`));

form.updateFieldAppearances(font);
await Bun.write(ziel, await doc.save());
const co = acro.lookup(PDFName.of("CO"), PDFArray);
console.log(`${ziel}: ${form.getFields().length} Felder, ${co.size()} berechnet`);
