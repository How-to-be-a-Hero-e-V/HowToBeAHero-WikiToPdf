import { BASE, $, esc, api, kopfleiste, anmeldeleiste, navFuer } from "./common.js";

$("#kopf").innerHTML = kopfleiste("sichten", "Sichtung", "Charakterbögen, die für alle angemeldeten Nutzer sichtbar werden sollen, prüfst du hier.", "Howky_frage.png");
const me = await anmeldeleiste($("#anmeldung"));
navFuer(me);

if (!me.redakteur) {
  $("#loading").innerHTML = me.angemeldet
    ? "Diese Seite ist für Redakteure. Wenn du meinst, du solltest hier hin, melde dich beim Vorstand."
    : `Bitte zuerst <a href="${me.anmeldelink}">im Wiki anmelden</a>.`;
} else {
  await laden();
}

function karte(b, offen) {
  const stand = b.oeffentlich ? "öffentlich" : b.abgelehnt ? "abgelehnt" : "wartet";
  return `<div class="sichtkarte ${stand}">
    ${b.hatPortrait ? `<img class="mini" src="${BASE}/api/boegen/${b.id}/portrait" alt="">` : `<div class="mini leer">?</div>`}
    <div class="bogeninfo">
      <strong>${esc(b.titel)}</strong>
      <span>von ${esc(b.besitzer)} · ${new Date(b.geaendert).toLocaleDateString("de-DE")}
      ${b.sichter ? ` · ${b.oeffentlich ? "freigegeben" : "abgelehnt"} von ${esc(b.sichter)}` : ""}
      ${b.sichtungGrund ? ` · „${esc(b.sichtungGrund)}“` : ""}</span>
    </div>
    <div class="bogenaktionen">
      <a class="linkbtn" href="${BASE}/api/boegen/${b.id}/pdf" target="_blank" rel="noopener">Ansehen</a>
      ${offen || b.abgelehnt ? `<button type="button" class="linkbtn" data-frei="${b.id}">Freigeben</button>` : ""}
      ${offen || b.oeffentlich ? `<button type="button" class="linkbtn gefahr" data-ab="${b.id}">Ablehnen</button>` : ""}
    </div>
  </div>`;
}

async function laden() {
  const { offen, erledigt } = await api("/api/sichtung");
  $("#loading").hidden = true;
  $("#inhalt").hidden = false;
  $("#anzahl").textContent = offen.length ? `${offen.length} offen` : "nichts offen";
  $("#offen").innerHTML = offen.length ? offen.map((b) => karte(b, true)).join("") : `<p class="hinweis">Gerade liegt nichts zur Sichtung an.</p>`;
  $("#erledigt").innerHTML = erledigt.length ? erledigt.map((b) => karte(b, false)).join("") : `<p class="hinweis">Noch nichts entschieden.</p>`;
}

document.addEventListener("click", async (e) => {
  const frei = e.target.closest("[data-frei]");
  const ab = e.target.closest("[data-ab]");
  if (!frei && !ab) return;
  const id = (frei ?? ab).dataset.frei ?? ab.dataset.ab;
  let grund = "";
  if (ab) {
    grund = prompt("Grund für die Ablehnung (sieht der Besitzer):", "") ?? "";
  }
  await api(`/api/boegen/${id}/sichten`, { method: "POST", body: { frei: !!frei, grund } });
  await laden();
});
