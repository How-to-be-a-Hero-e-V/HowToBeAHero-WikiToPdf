import { BASE, $, $$, esc, api, kopfleiste, anmeldeleiste, navFuer } from "./common.js";
import { berechne, leererCharakter, wuerfleCharakter, GRUPPEN, GRUPPEN_LABEL, MAX_ZEILEN, PUNKTE_GESAMT, restText } from "./rules.js";
import { maleditor } from "./malen.js";

const KOPFFELDER = ["name", "geschlecht", "alter", "lebenspunkte", "statur", "religion", "beruf", "familienstand"];
const ENTWURF = "htbah-bogen-entwurf";

$("#kopf").innerHTML = kopfleiste("bogen", "Charakterbogen", "Fülle deinen Helden hier aus, würfle ihn aus oder male sein Portrait. Am Ende kommt ein fertiges PDF heraus.", "Howky_lesen.png");
const me = await anmeldeleiste($("#anmeldung"));
navFuer(me);
const cat = await api("/api/catalog");
$("#wikilink").href = cat.wiki;

const zustand = { id: null, design: "standard", portrait: null, portraitUrl: null, portraitGeaendert: false };

// ---------------------------------------------------------------- Aufbau
$("#gruppen").innerHTML = GRUPPEN.map((g) => `
  <div class="gruppe" data-gruppe="${g}">
    <div class="gruppe-kopf">
      <h3>${GRUPPEN_LABEL[g]}</h3>
      <div class="gruppe-werte">
        <span title="Begabungswert">Begabung <b id="beg-${g}">0</b></span>
        <span title="Geistesblitzpunkte">GBP <b id="gbp-${g}">0</b></span>
        <span title="Punkte in dieser Gruppe">Punkte <b id="pkt-${g}">0</b></span>
      </div>
    </div>
    <div class="zeilen">
      <div class="zeile kopfzeile"><span>Fähigkeit</span><span>Punkte</span><span>Wert</span></div>
      ${Array.from({ length: MAX_ZEILEN }, (_, i) => `
        <div class="zeile">
          <input type="text" maxlength="60" data-g="${g}" data-i="${i}" data-feld="n" placeholder="…">
          <input type="number" min="0" max="100" step="1" data-g="${g}" data-i="${i}" data-feld="p">
          <output data-wert="${g}-${i}">–</output>
        </div>`).join("")}
    </div>
  </div>`).join("");

$("#designs").innerHTML = cat.sheets.map((s, i) => `
  <label class="item${i === 0 ? " sel" : ""}">
    <input type="radio" name="design" value="${esc(s.id)}"${i === 0 ? " checked" : ""}>
    <span><b>${esc(s.name)}</b><span class="desc">${esc(s.description || "")}</span></span>
  </label>`).join("");

$("#loading").hidden = true;
$("#form").hidden = false;

// ---------------------------------------------------------------- Daten lesen und schreiben
function lese() {
  const ch = leererCharakter();
  for (const f of KOPFFELDER) ch[f] = $(`#f-${f}`).value.trim();
  ch.inventar = $("#f-inventar").value.trim();
  ch.anmerkungen = $("#f-anmerkungen").value.trim();
  for (const g of GRUPPEN) {
    ch[g] = Array.from({ length: MAX_ZEILEN }, (_, i) => ({
      n: $(`[data-g="${g}"][data-i="${i}"][data-feld="n"]`).value.trim(),
      p: Number($(`[data-g="${g}"][data-i="${i}"][data-feld="p"]`).value) || 0,
    })).filter((f) => f.n || f.p);
  }
  return ch;
}

function schreibe(ch) {
  for (const f of KOPFFELDER) $(`#f-${f}`).value = ch[f] ?? "";
  $("#f-inventar").value = ch.inventar ?? "";
  $("#f-anmerkungen").value = ch.anmerkungen ?? "";
  for (const g of GRUPPEN) {
    for (let i = 0; i < MAX_ZEILEN; i++) {
      const f = (ch[g] ?? [])[i];
      $(`[data-g="${g}"][data-i="${i}"][data-feld="n"]`).value = f?.n ?? "";
      $(`[data-g="${g}"][data-i="${i}"][data-feld="p"]`).value = f?.p ? String(f.p) : "";
    }
  }
  rechne();
}

function rechne() {
  const w = berechne(lese());
  for (const g of GRUPPEN) {
    const gw = w.gruppen[g];
    $(`#beg-${g}`).textContent = gw.begabung;
    $(`#gbp-${g}`).textContent = gw.gbp;
    $(`#pkt-${g}`).textContent = gw.punkte;
    for (let i = 0; i < MAX_ZEILEN; i++) {
      const zeile = gw.zeilen[i];
      $(`[data-wert="${g}-${i}"]`).textContent = zeile ? zeile.wert : "–";
    }
  }
  const stand = $("#punktestand");
  stand.textContent = `${w.ausgegeben} von ${PUNKTE_GESAMT} vergeben · ${restText(w.rest)}`;
  stand.className = w.rest < 0 ? "zuviel" : w.rest === 0 ? "genau" : "";
  $("#warnungen").textContent = w.warnungen.join(" ");
  if (!me.angemeldet) try { localStorage.setItem(ENTWURF, JSON.stringify({ ch: lese(), design: zustand.design })); } catch {}
}

$("#form").addEventListener("input", (e) => { if (e.target.matches("input,textarea")) rechne(); });
$("#form").addEventListener("change", (e) => {
  if (e.target.name === "design") {
    zustand.design = e.target.value;
    $$("#designs label").forEach((l) => l.classList.toggle("sel", l.querySelector("input").checked));
  }
});

// ---------------------------------------------------------------- Portrait
function zeigePortrait() {
  const box = $("#portrait-bild");
  const quelle = zustand.portrait ?? zustand.portraitUrl;
  box.innerHTML = quelle ? `<img src="${quelle}" alt="Portrait">` : "<span>kein Portrait</span>";
  $("#portrait-weg").hidden = !quelle;
}
$("#portrait-laden").addEventListener("click", () => $("#portrait-datei").click());
$("#portrait-datei").addEventListener("change", (e) => {
  const datei = e.target.files?.[0];
  e.target.value = "";
  if (!datei) return;
  const leser = new FileReader();
  leser.onload = () => oeffneMaler(leser.result);   // Upload landet im Editor, dort passt der Nutzer es an
  leser.readAsDataURL(datei);
});
$("#portrait-weg").addEventListener("click", () => {
  zustand.portrait = null; zustand.portraitUrl = null; zustand.portraitGeaendert = true; zeigePortrait();
});

let maler = null;
function oeffneMaler(startbild) {
  $("#malmodal").hidden = false;
  maler = maleditor($("#malhost"), { start: startbild ?? zustand.portrait ?? zustand.portraitUrl ?? null });
}
$("#portrait-malen").addEventListener("click", () => oeffneMaler());
$("#mal-abbruch").addEventListener("click", () => { $("#malmodal").hidden = true; $("#malhost").innerHTML = ""; maler = null; });
$("#mal-ok").addEventListener("click", () => {
  if (maler) { zustand.portrait = maler.alsDataUrl(); zustand.portraitUrl = null; zustand.portraitGeaendert = true; zeigePortrait(); }
  $("#malmodal").hidden = true; $("#malhost").innerHTML = ""; maler = null;
});

// ---------------------------------------------------------------- Zufall
$("#zufall").addEventListener("click", () => {
  if (!cat.randomizer) { melde("Für den Zufallsgenerator fehlen die Tabellen im Katalog."); return; }
  schreibe(wuerfleCharakter(cat.randomizer));
  melde("Ausgewürfelt. Ändere frei, was dir nicht passt.");
});

// ---------------------------------------------------------------- Speichern, PDF, Liste
const melde = (t, fehler = false) => { const s = $("#status"); s.textContent = t; s.className = fehler ? "fehler" : "ok"; };

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!me.angemeldet) { melde("Zum Speichern musst du im Wiki angemeldet sein. Als PDF geht es auch ohne.", true); return; }
  const koerper = {
    id: zustand.id, titel: $("#f-titel").value.trim(), design: zustand.design,
    daten: lese(), freigegeben: $("#f-frei").checked,
    freigabeNamen: $("#f-freigabe").value.split(/[,;|]/).map((x) => x.trim()).filter(Boolean),
  };
  if (zustand.portraitGeaendert) koerper.portrait = zustand.portrait;   // sonst bleibt das gespeicherte Bild
  try {
    $("#speichern").disabled = true;
    const { bogen, unbekannteNutzer } = await api("/api/boegen", { method: "POST", body: koerper });
    zustand.id = bogen.id; zustand.portraitGeaendert = false;
    $("#f-freigabe").value = (bogen.freigabeNamen ?? []).join(", ");
    const wem = bogen.oeffentlich ? "öffentlich für alle angemeldeten Nutzer"
      : bogen.wartet ? "zur Sichtung bei den Redakteuren"
      : bogen.abgelehnt ? `von der Sichtung abgelehnt${bogen.sichtungGrund ? ` (${bogen.sichtungGrund})` : ""}`
      : (bogen.freigabeNamen?.length ? `freigegeben für ${bogen.freigabeNamen.join(", ")}` : "nur für dich");
    melde(`Gespeichert als „${bogen.titel}“, ${wem}.` + (unbekannteNutzer?.length ? ` Unbekannt im Wiki: ${unbekannteNutzer.join(", ")}.` : ""), !!unbekannteNutzer?.length);
    await ladeListe();
  } catch (err) { melde(err.message, true); }
  finally { $("#speichern").disabled = false; }
});

$("#pdf").addEventListener("click", async () => {
  melde("PDF wird gebaut …");
  try {
    const r = await fetch(BASE + "/api/bogen/pdf", {
      method: "POST", headers: { "X-HTBAH": "1", "content-type": "application/json" },
      body: JSON.stringify({ daten: lese(), design: zustand.design, portrait: zustand.portrait ?? (zustand.portraitUrl ? await alsDataUrl(zustand.portraitUrl) : null) }),
    });
    if (!r.ok) throw new Error(await r.text());
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `HTBAH_${(lese().name || "Charakterbogen").replace(/\s+/g, "_")}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    melde("PDF fertig.");
  } catch (err) { melde(err.message, true); }
});

async function alsDataUrl(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const blob = await r.blob();
  return new Promise((f) => { const l = new FileReader(); l.onload = () => f(l.result); l.readAsDataURL(blob); });
}

$("#neu").addEventListener("click", () => {
  zustand.id = null; zustand.portrait = null; zustand.portraitUrl = null; zustand.portraitGeaendert = true;
  $("#f-titel").value = ""; $("#f-frei").checked = false; $("#f-freigabe").value = "";
  schreibe(leererCharakter()); zeigePortrait(); melde("Leerer Bogen.");
});

function zustandText(b) {
  if (b.oeffentlich) return " · öffentlich";
  if (b.wartet) return " · wartet auf Sichtung";
  if (b.abgelehnt) return ` · abgelehnt${b.sichtungGrund ? `: ${esc(b.sichtungGrund)}` : ""}`;
  if (b.freigabeNamen?.length) return ` · für ${esc(b.freigabeNamen.join(", "))}`;
  return "";
}

function bogenKarte(b) {
  return `<div class="bogenkarte">
    ${b.hatPortrait ? `<img class="mini" src="${BASE}/api/boegen/${b.id}/portrait" alt="">` : `<div class="mini leer">?</div>`}
    <div class="bogeninfo">
      <strong>${esc(b.titel)}</strong>
      <span>${esc(b.besitzer)} · ${new Date(b.geaendert).toLocaleDateString("de-DE")}${zustandText(b)}</span>
    </div>
    <div class="bogenaktionen">
      <button type="button" class="linkbtn" data-laden="${b.id}">Öffnen</button>
      <a class="linkbtn" href="${BASE}/api/boegen/${b.id}/pdf" target="_blank" rel="noopener">PDF</a>
      ${b.eigener || me.admin ? `<button type="button" class="linkbtn gefahr" data-loeschen="${b.id}">Löschen</button>` : ""}
    </div>
  </div>`;
}

async function ladeListe() {
  if (!me.angemeldet) {
    $("#liste-eigene").innerHTML = `<p class="hinweis">Melde dich im Wiki an, dann kannst du Bögen speichern und freigeben.</p>`;
    $("#liste-fremd").innerHTML = "";
    return;
  }
  const { eigene, fuerMich, freigegeben } = await api("/api/boegen");
  $("#liste-eigene").innerHTML = eigene.length ? eigene.map(bogenKarte).join("") : `<p class="hinweis">Noch nichts gespeichert.</p>`;
  const fremd = [...(fuerMich ?? []), ...(freigegeben ?? [])];
  $("#liste-fremd").innerHTML = fremd.length ? fremd.map(bogenKarte).join("") : `<p class="hinweis">Bisher hat niemand einen Bogen für dich freigegeben.</p>`;
}

document.addEventListener("click", async (e) => {
  const laden = e.target.closest("[data-laden]");
  if (laden) {
    const { bogen } = await api(`/api/boegen/${laden.dataset.laden}`);
    zustand.id = bogen.eigener || me.admin ? bogen.id : null;      // fremde Bögen werden als Kopie geöffnet
    zustand.design = bogen.design;
    zustand.portrait = null;
    zustand.portraitUrl = bogen.hatPortrait ? `${BASE}/api/boegen/${bogen.id}/portrait` : null;
    zustand.portraitGeaendert = !zustand.id;
    $("#f-titel").value = bogen.eigener ? bogen.titel : `${bogen.titel} (Kopie)`;
    $("#f-frei").checked = bogen.eigener && bogen.freigegeben;
    $("#f-freigabe").value = bogen.eigener ? (bogen.freigabeNamen ?? []).join(", ") : "";
    $$("input[name=design]").forEach((r) => { r.checked = r.value === bogen.design; });
    $$("#designs label").forEach((l) => l.classList.toggle("sel", l.querySelector("input").checked));
    schreibe(bogen.daten); zeigePortrait();
    melde(zustand.id ? `„${bogen.titel}“ geöffnet.` : `Kopie von „${bogen.titel}“ geöffnet, Speichern legt einen eigenen Bogen an.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const weg = e.target.closest("[data-loeschen]");
  if (weg && confirm("Diesen Bogen wirklich löschen?")) {
    await api(`/api/boegen/${weg.dataset.loeschen}/loeschen`, { method: "POST" });
    if (zustand.id === weg.dataset.loeschen) zustand.id = null;
    await ladeListe();
    melde("Gelöscht.");
  }
});

// ---------------------------------------------------------------- Start
if (!me.angemeldet) {
  try {
    const roh = JSON.parse(localStorage.getItem(ENTWURF) || "null");
    if (roh?.ch) { schreibe(roh.ch); zustand.design = roh.design ?? "standard";
      $$("input[name=design]").forEach((r) => { r.checked = r.value === zustand.design; });
      $$("#designs label").forEach((l) => l.classList.toggle("sel", l.querySelector("input").checked)); }
  } catch {}
}
zeigePortrait();
rechne();
await ladeListe();
