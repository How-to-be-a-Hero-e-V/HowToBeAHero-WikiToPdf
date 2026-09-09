// Gemeinsame Helfer für Buch-Baukasten und Charakterbogen.
export const BASE = location.pathname.replace(/\/(buch|bogen|sichten|index\.html)?\/?$/, "") || "";
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function api(pfad, opt = {}) {
  const o = { ...opt, headers: { "X-HTBAH": "1", ...(opt.headers || {}) } };
  if (o.body && typeof o.body !== "string") { o.body = JSON.stringify(o.body); o.headers["content-type"] = "application/json"; }
  const r = await fetch(BASE + pfad, o);
  const typ = r.headers.get("content-type") || "";
  if (!typ.includes("json")) { if (!r.ok) throw new Error(await r.text()); return r; }
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `Fehler ${r.status}`);
  return j;
}

/** Kopfleiste mit Navigation; hebt die aktuelle Seite hervor. */
let aktuelleSeite = "";

/** Sichtungs-Link erscheint nur für Redakteure. */
export function navFuer(me) {
  if (!me?.redakteur) return;
  const nav = document.querySelector(".nav");
  if (!nav || nav.querySelector("[data-sichten]")) return;
  const offen = me.offeneSichtungen ? ` (${me.offeneSichtungen})` : "";
  nav.insertAdjacentHTML("beforeend",
    `<a class="navlink${aktuelleSeite === "sichten" ? " aktiv" : ""}" data-sichten href="${BASE}/sichten">Sichtung${offen}</a>`);
}

export function kopfleiste(aktiv, titel, untertitel, howky = "Howky_hauptseite.png") {
  const nav = [["buch", "Buch-Baukasten"], ["bogen", "Charakterbogen"]]
    .map(([id, t]) => `<a class="navlink${id === aktiv ? " aktiv" : ""}" href="${BASE}/${id}">${t}</a>`).join("");
  aktuelleSeite = aktiv;
  return `<div class="top-box">
    <a href="${BASE}/" class="loglink"><img src="${BASE}/logo.png" alt="How to be a Hero" class="logo"></a>
    <div>
      <h1>${esc(titel)}</h1>
      <p>${esc(untertitel)}</p>
      <nav class="nav">${nav}</nav>
    </div>
    <img src="${BASE}/assets/${howky}" alt="" class="howky">
  </div>`;
}

/** Anmeldestand rechts oben. */
export async function anmeldeleiste(el) {
  try {
    const me = await api("/api/me");
    el.innerHTML = me.angemeldet
      ? `Angemeldet als <strong>${esc(me.name)}</strong>`
      : `<a href="${me.anmeldelink}">Im Wiki anmelden</a>, um Bögen zu speichern`;
    return me;
  } catch { el.textContent = ""; return { angemeldet: false }; }
}
