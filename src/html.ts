import { parse, HTMLElement } from "node-html-parser";
import { cfg } from "./config";
import { pageUrl, thumbUrls } from "./wiki";
import { join } from "node:path";

export interface Chapter { id: string; title: string; html: string; revid: number; wikiTitle: string; headings: { id: string; text: string }[] }
export interface Part { id: string; name: string; chapters: Chapter[] }
export interface Book { title: string; fmt: "a4" | "a5"; parts: Part[]; sheetName?: string; created: Date }

const tplDir = join(import.meta.dir, "..", "template");
const css = await Bun.file(join(tplDir, "book.css")).text();
const pagedjs = await Bun.file(join(import.meta.dir, "..", "node_modules/pagedjs/dist/paged.polyfill.js")).text();
async function dataUri(file: string) {
  const f = Bun.file(join(tplDir, "images", file));
  return `data:image/png;base64,${Buffer.from(await f.arrayBuffer()).toString("base64")}`;
}
const img = {
  logo: await dataUri("LogoHD_300dpi.png"),
  footer: await dataUri("Footerimage.png"),
  pagenum: await dataUri("Seitenzahlverschönerer1.png"),
  dice: await Promise.all(["W20Rot.png", "W6Grün.png", "W8Blau.png", "W20Violett.png", "W6Rot.png"].map(dataUri)),
};

export const decode = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => { const l = e.toLowerCase(); if (l[0] === "#") return String.fromCodePoint(l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10)); return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" } as any)[l] ?? m; });
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const internalBase = (() => { const u = new URL(cfg.wikiIndex); return `${u.protocol}//${u.host}`; })();

function titleFromHref(href: string): string | null {
  try {
    const u = new URL(href, cfg.publicWiki);
    if (u.host !== new URL(cfg.publicWiki).host) return null;
    const t = u.searchParams.get("title");
    if (t) return t.replace(/_/g, " ");
    const m = u.pathname.match(/^\/wiki\/(.+)$/);
    if (m) return decodeURIComponent(m[1]).replace(/_/g, " ");
  } catch {}
  return null;
}

// Bereinigt das Artikel-HTML aus action=parse fuer den Druck.
const MAX_IMG_PX = 1400;

export async function cleanChapter(raw: string, ch: { id: string; title: string; revid: number; wikiTitle: string }, bookTitles: Map<string, string>, badges: string[]): Promise<Chapter> {
  const root = parse(raw, { blockTextElements: { script: false, style: true, pre: true } });
  const kill = [".mw-editsection", ".noprint", "#toc", ".toc", ".printfooter", ".catlinks", ".mw-empty-elt", "script", ".navbox", ".sidebarticker", "#sidebarticker", ".mw-indicators", ".metadata", ".ambox"];
  for (const sel of kill) root.querySelectorAll(sel).forEach(e => e.remove());
  // Offiziell/Bestaetigt/Wild-Abzeichen
  root.querySelectorAll("figure, div.floatright, div.thumb").forEach(f => {
    const src = f.querySelector("img")?.getAttribute("src") ?? "";
    if (badges.some(b => src.includes(b))) f.remove();
  });
  // Videos: Hinweis statt Einbettung
  root.querySelectorAll(".embedvideo, .embedvideowrap, .embedvideo-consent").forEach(e => {
    const a = e.querySelector("a[href^='http']")?.getAttribute("href");
    e.replaceWith(`<p class="video-note">🎬 Video im Wiki: ${esc(a ?? pageUrl(ch.wikiTitle))}</p>`);
  });
  // Klappboxen und NavFrames aufklappen
  root.querySelectorAll(".mw-collapsible").forEach(e => { e.classList.remove("mw-collapsed"); e.classList.remove("mw-collapsible"); });
  root.querySelectorAll(".mw-collapsible-toggle, .NavToggle").forEach(e => e.remove());
  root.querySelectorAll(".NavFrame").forEach(e => e.classList.remove("collapsed"));
  // Bilder: intern laden, keine srcset; grosse Originale durch Thumbnails ersetzen (Dateigroesse)
  const big = new Map<string, HTMLElement[]>();
  root.querySelectorAll("img").forEach(im => {
    let src = im.getAttribute("src") ?? "";
    im.removeAttribute("srcset");
    im.removeAttribute("loading");
    src = src.replace(/^https?:\/\/[^/]+/, "");
    if (!src.startsWith("/")) { if (!src.startsWith("data:")) im.remove(); return; }
    im.setAttribute("src", internalBase + src);
    const fileW = Number(im.getAttribute("data-file-width"));
    const isThumb = /\/images\/thumb\//.test(src);
    const m = src.match(/\/images\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)$/);
    if (!isThumb && m && fileW > MAX_IMG_PX) { const name = decodeURIComponent(m[1]); (big.get(name) ?? big.set(name, []).get(name)!).push(im); }
    const w = Number(im.getAttribute("width")); if (w) im.setAttribute("style", `width:${Math.min(w, 800)}px;height:auto;max-width:100%`);
  });
  if (big.size) {
    const thumbs = await thumbUrls([...big.keys()], MAX_IMG_PX);
    for (const [name, imgs] of big) { const t = thumbs.get(name); if (t) imgs.forEach(im => im.setAttribute("src", t)); }
  }
  // IDs pro Kapitel eindeutig machen, Links auf Buchkapitel als interne Sprungziele
  const prefix = `${ch.id}-`;
  root.querySelectorAll("[id]").forEach(e => { const id = e.getAttribute("id"); if (id) e.setAttribute("id", prefix + id); });
  root.querySelectorAll("a[href]").forEach(a => {
    const href = a.getAttribute("href")!;
    if (href.startsWith("#")) { a.setAttribute("href", "#" + prefix + href.slice(1)); return; }
    const t = titleFromHref(href);
    if (t) {
      const base = t.split("#")[0];
      const target = bookTitles.get(base.toLowerCase());
      if (target) a.setAttribute("href", `#${target}`);
      else { a.setAttribute("href", new URL(href, cfg.publicWiki).toString()); a.classList.add("ext"); }
    } else if (href.startsWith("http")) a.classList.add("ext");
    else a.removeAttribute("href");
  });
  // Ueberschriften: Artikel-h1 wird zu h2 (Kapitel ist h1), Ueberschriften fuers Inhaltsverzeichnis sammeln
  const headings: { id: string; text: string }[] = [];
  root.querySelectorAll("h1").forEach(h => (h.tagName = "H2"));
  root.querySelectorAll("h2").forEach((h, i) => {
    h.querySelectorAll(".mw-editsection").forEach(e => e.remove());
    let id = h.getAttribute("id") ?? h.querySelector(".mw-headline")?.getAttribute("id");
    if (!id) { id = `${prefix}h${i}`; h.setAttribute("id", id); }
    headings.push({ id, text: decode(h.textContent).replace(/\s+/g, " ").trim() });
  });
  // Style-Tags der TemplateStyles bleiben erhalten (sind auf .mw-parser-output gescoped)
  return { ...ch, html: root.toString(), headings };
}

export function buildDocument(book: Book): string {
  const date = book.created.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
  const multi = book.parts.length > 1;
  let toc = "";
  let body = "";
  for (const part of book.parts) {
    if (multi) {
      toc += `<li class="toc-part"><a href="#${esc(part.id)}"><span class="t">${esc(part.name)}</span><span class="spacer"></span></a></li>`;
      body += `<section class="part-title" id="${part.id}"><div class="part-inner"><div class="part-kicker">Teil</div><h1>${esc(part.name)}</h1></div></section>`;
    }
    for (const ch of part.chapters) {
      toc += `<li class="toc-ch"><a href="#${esc(ch.id)}"><span class="t">${esc(ch.title)}</span><span class="spacer"></span></a>`;
      const sub = ch.headings.filter(h => h.text && h.text.length < 90).slice(0, 25);
      if (sub.length) toc += `<ol>${sub.map(h => `<li><a href="#${esc(h.id)}"><span class="t">${esc(h.text)}</span><span class="spacer"></span></a></li>`).join("")}</ol>`;
      toc += `</li>`;
      body += `<section class="chapter" id="${ch.id}"><h1 class="chapter-title"><span>${esc(ch.title)}</span></h1><div class="mw-content-ltr mw-parser-output">${ch.html}</div></section>`;
    }
  }
  const sources = book.parts.flatMap(p => p.chapters).map(c => `<li>${esc(c.title)} – <span class="url">${esc(pageUrl(c.wikiTitle, c.revid))}</span></li>`).join("");
  const cover = `
<section class="cover">
  <img class="cover-logo" src="${img.logo}" alt="How to be a Hero">
  <div class="cover-title">${esc(book.title)}</div>
  <div class="cover-sub">aus dem How-to-be-a-Hero-Wiki · Stand ${esc(date)}</div>
  <div class="cover-dice">${img.dice.map(d => `<img src="${d}" alt="">`).join("")}</div>
  <img class="cover-footer" src="${img.footer}" alt="">
</section>`;
  const tocPage = `<section class="toc-page"><h1 class="toc-title">Inhalt</h1><ol class="toc">${toc}${book.sheetName ? `<li class="toc-ch"><span class="noref">Charakterbogen: ${esc(book.sheetName)} (am Ende des Buchs)</span></li>` : ""}</ol></section>`;
  const license = `
<section class="license" id="lizenz">
  <h1 class="chapter-title"><span>Lizenz und Quellen</span></h1>
  <p>Dieses Buch wurde am ${esc(date)} automatisch aus dem How-to-be-a-Hero-Wiki (howtobeahero.de) zusammengestellt. Die Texte stammen von der Wiki-Community und stehen unter der Lizenz <strong>Creative Commons Namensnennung – Nicht-kommerziell – Weitergabe unter gleichen Bedingungen 4.0</strong> (CC BY-NC-SA 4.0). Du darfst das Buch teilen und verändern, solange du die Quelle nennst, es nicht kommerziell nutzt und Bearbeitungen unter derselben Lizenz weitergibst.</p>
  <p>Die Autorinnen und Autoren jeder Seite findest du in der Versionsgeschichte im Wiki. Aktuelle Fassungen, Diskussionen und Korrekturen gibt es dort ebenfalls, dieses PDF ist eine Momentaufnahme.</p>
  <p>How to be a Hero e. V., <span class="url">https://howtobeahero.de</span></p>
  <h2>Enthaltene Seiten</h2>
  <ol class="sources">${sources}</ol>
</section>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(book.title)}</title>
<style>${css}</style>
<style>
@page { size: ${book.fmt.toUpperCase()}; }
:root { --pagenum-img: url("${img.pagenum}"); --footer-img: url("${img.footer}"); }
</style>
<script>
window.PagedConfig = { auto: true, before: () => window.__shrinkImages(${MAX_IMG_PX}), after: () => { window.__pagedDone = true; } };
// Bilder, die das Wiki nicht verkleinern konnte, im Browser auf MAX_IMG_PX Breite bringen (Dateigroesse)
window.__shrinkImages = async function (max) {
  const imgs = [...document.images];
  console.warn("shrink: " + imgs.length + " Bilder, " + imgs.filter(i => !i.complete).length + " noch ladend");
  await Promise.all(imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r; })));
  for (const im of imgs) {
    if (im.naturalWidth <= max && im.naturalHeight <= max) continue;
    try {
      const f = Math.min(max / im.naturalWidth, max / im.naturalHeight);
      const c = document.createElement("canvas");
      c.width = Math.round(im.naturalWidth * f); c.height = Math.round(im.naturalHeight * f);
      const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(im, 0, 0, c.width, c.height);
      const jpeg = /\\.jpe?g($|\\?)/i.test(im.src);
      im.src = jpeg ? c.toDataURL("image/jpeg", 0.85) : c.toDataURL("image/png");
      await new Promise(r => { im.onload = im.onerror = r; });
    } catch (e) { console.warn("shrink failed", im.src, e); }
  }
  console.warn("shrink: fertig");
};
</script>
</head><body class="fmt-${book.fmt}">
${cover}${tocPage}${body}${license}
<script>${pagedjs}</script>
</body></html>`;
}
