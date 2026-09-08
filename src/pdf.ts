import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFBool } from "pdf-lib";

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
    for (const k of ["DA", "DR", "Q"]) {
      const v = srcAcro.get(PDFName.of(k));
      if (v && !acro.has(PDFName.of(k))) acro.set(PDFName.of(k), book.context.obj(v as any) as any);
    }
  }
  acro.set(PDFName.of("NeedAppearances"), PDFBool.True);
  const seen = new Set<string>();
  const calc: PDFRef[] = [];
  for (const p of pages) {
    book.addPage(p);
    const annots = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (!(ref instanceof PDFRef)) continue;
      const a = book.context.lookup(ref, PDFDict);
      if (!a || a.get(PDFName.of("Subtype"))?.toString() !== "/Widget") continue;
      let top: PDFRef = ref, d: PDFDict = a;
      while (d.has(PDFName.of("Parent"))) {
        const pr = d.get(PDFName.of("Parent")) as PDFRef;
        const pd = book.context.lookup(pr, PDFDict);
        if (!pd) break;
        top = pr; d = pd;
      }
      if (seen.has(top.toString())) continue;
      seen.add(top.toString());
      fields.push(top);
      const aa = d.lookupMaybe(PDFName.of("AA"), PDFDict);
      if (aa?.has(PDFName.of("C"))) calc.push(top);
    }
  }
  if (calc.length) acro.set(PDFName.of("CO"), book.context.obj(calc));
}

export async function finalizeBook(pdfBytes: Uint8Array, opts: { title: string; sheet?: Uint8Array; sheetName?: string }): Promise<Uint8Array> {
  const book = await PDFDocument.load(pdfBytes);
  if (opts.sheet) {
    await appendForm(book, opts.sheet);
    // Original zusaetzlich als Anhang, falls ein Viewer die Felder im Buch nicht anzeigt
    await book.attach(opts.sheet, opts.sheetName ?? "Charakterbogen.pdf", { mimeType: "application/pdf", description: "Charakterbogen (ausfüllbar)" });
  }
  book.setTitle(opts.title);
  book.setAuthor("How to be a Hero e. V. und die Wiki-Community");
  book.setProducer("HTBAH WikiToPdf 2");
  book.setCreator("howtobeahero.de");
  book.setCreationDate(new Date());
  return book.save({ useObjectStreams: true });
}
