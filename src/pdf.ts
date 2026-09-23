import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFBool, PDFString, PDFHexString, PDFObjectCopier, type PDFContext } from "pdf-lib";

// Haengt ein Formular-PDF (Charakterbogen) an das Buch an. copyPages uebernimmt die Widgets ueber
// /Annots, aber nicht den AcroForm-Katalog; der wird hier aus den kopierten Widgets neu aufgebaut,
// damit die Felder (und ihre Berechnungen) im Buch weiter funktionieren.
export async function appendForm(book: PDFDocument, sheetBytes: Uint8Array) {
  const src = await PDFDocument.load(sheetBytes, { ignoreEncryption: true });
  const pages = await book.copyPages(src, src.getPageIndices());
  const srcAcro = src.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  let acro = book.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (!acro) {
    acro = book.context.obj({ Fields: [] });
    book.catalog.set(PDFName.of("AcroForm"), book.context.register(acro));
  }
  const fields = acro.lookup(PDFName.of("Fields"), PDFArray);
  if (srcAcro) {
    // Standardschrift und -ressourcen samt Unterobjekten ins Buch kopieren, nicht nur verweisen
    const kopierer = PDFObjectCopier.for(src.context, book.context);
    for (const k of ["DA", "DR", "Q"]) {
      const v = srcAcro.get(PDFName.of(k));
      if (v && !acro.has(PDFName.of(k))) acro.set(PDFName.of(k), kopierer.copy(v));
    }
  }
  acro.set(PDFName.of("NeedAppearances"), PDFBool.True);

  const vollName = (ctx: PDFContext, d: PDFDict | undefined) => {
    const teile: string[] = [];
    for (let x = d; x; ) {
      const t = x.get(PDFName.of("T"));
      if (t instanceof PDFString || t instanceof PDFHexString) teile.unshift(t.decodeText());
      const p = x.get(PDFName.of("Parent"));
      x = p ? ctx.lookupMaybe(p, PDFDict) : undefined;
    }
    return teile.join(".");
  };

  const seen = new Set<string>();
  const berechnet = new Map<string, PDFRef>();
  for (const p of pages) {
    book.addPage(p);
    const annots = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (!(ref instanceof PDFRef)) continue;
      const a = book.context.lookup(ref, PDFDict);
      if (!a || a.get(PDFName.of("Subtype"))?.toString() !== "/Widget") continue;
      // Wurzelfeld für /Fields, Endfeld (trägt Name und Aktionen) für die Rechenreihenfolge
      let top: PDFRef = ref, d: PDFDict = a;
      while (d.has(PDFName.of("Parent"))) {
        const pr = d.get(PDFName.of("Parent")) as PDFRef;
        const pd = book.context.lookup(pr, PDFDict);
        if (!pd) break;
        top = pr; d = pd;
      }
      if (!seen.has(top.toString())) { seen.add(top.toString()); fields.push(top); }
      const endRef = a.has(PDFName.of("T")) ? ref : (a.get(PDFName.of("Parent")) as PDFRef | undefined);
      const endDict = endRef ? book.context.lookupMaybe(endRef, PDFDict) : undefined;
      if (endRef && endDict?.lookupMaybe(PDFName.of("AA"), PDFDict)?.has(PDFName.of("C")))
        berechnet.set(vollName(book.context, endDict), endRef);
    }
  }

  // Rechenreihenfolge der Vorlage übernehmen, sonst rechnen Felder mit veralteten Zwischenwerten
  const reihenfolge: PDFRef[] = [];
  const srcCo = srcAcro?.lookupMaybe(PDFName.of("CO"), PDFArray);
  for (let i = 0; srcCo && i < srcCo.size(); i++) {
    const name = vollName(src.context, src.context.lookupMaybe(srcCo.get(i), PDFDict));
    const r = berechnet.get(name);
    if (r) { reihenfolge.push(r); berechnet.delete(name); }
  }
  reihenfolge.push(...berechnet.values());
  if (reihenfolge.length) {
    const alt = acro.lookupMaybe(PDFName.of("CO"), PDFArray);
    const co = alt ?? book.context.obj([]);
    for (const r of reihenfolge) co.push(r);
    acro.set(PDFName.of("CO"), co);
  }
}

/** Fertige Charakterbögen anhängen: reine Seiten, damit sich Formularfelder nicht überlagern. */
export async function appendPages(book: PDFDocument, bytes: Uint8Array) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = await book.copyPages(src, src.getPageIndices());
  pages.forEach((p) => book.addPage(p));
}

export async function finalizeBook(pdfBytes: Uint8Array, opts: { title: string; sheet?: Uint8Array; sheetName?: string; boegen?: Uint8Array[] }): Promise<Uint8Array> {
  const book = await PDFDocument.load(pdfBytes);
  if (opts.sheet) {
    await appendForm(book, opts.sheet);
    // Original zusaetzlich als Anhang, falls ein Viewer die Felder im Buch nicht anzeigt
    await book.attach(opts.sheet, opts.sheetName ?? "Charakterbogen.pdf", { mimeType: "application/pdf", description: "Charakterbogen (ausfüllbar)" });
  }
  for (const b of opts.boegen ?? []) await appendPages(book, b);
  book.setTitle(opts.title);
  book.setAuthor("How to be a Hero e. V. und die Wiki-Community");
  book.setProducer("HTBAH WikiToPdf 2");
  book.setCreator("howtobeahero.de");
  book.setCreationDate(new Date());
  return book.save({ useObjectStreams: true });
}
