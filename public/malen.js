// Kleines Malprogramm für das Charakterportrait: Stift, Linie, Rechteck, Ellipse,
// Füllen, Radierer, Pipette, Farben, Strichstärken und Stricharten, Rückgängig.

const WERKZEUGE = [
  { id: "stift", name: "Stift", icon: "✏️" },
  { id: "linie", name: "Linie", icon: "／" },
  { id: "rechteck", name: "Rechteck", icon: "▭" },
  { id: "ellipse", name: "Kreis", icon: "◯" },
  { id: "fuellen", name: "Füllen", icon: "🪣" },
  { id: "radierer", name: "Radierer", icon: "🧽" },
  { id: "pipette", name: "Pipette", icon: "🎯" },
];
const FARBEN = [
  "#101020", "#ffffff", "#509848", "#286840", "#0880c8", "#0848a0", "#e07028", "#a84c10",
  "#ff3939", "#8b2f8b", "#f0c419", "#e0a878", "#603030", "#a3acbe", "#838fa7", "#d8e0e0",
];
const STRICHARTEN = [
  { id: "voll", name: "durchgezogen", dash: [] },
  { id: "strich", name: "gestrichelt", dash: [14, 10] },
  { id: "punkt", name: "gepunktet", dash: [2, 8] },
];

export function maleditor(host, { breite = 672, hoehe = 822, start = null } = {}) {
  host.innerHTML = `
    <div class="mal">
      <div class="mal-werkzeuge">
        <div class="mal-gruppe" id="mal-tools"></div>
        <div class="mal-gruppe">
          <label class="mal-label">Stärke <output id="mal-staerke-wert">6</output></label>
          <input type="range" id="mal-staerke" min="1" max="48" value="6">
        </div>
        <div class="mal-gruppe" id="mal-strichart"></div>
        <div class="mal-gruppe">
          <label class="mal-check"><input type="checkbox" id="mal-gefuellt"> gefüllt</label>
        </div>
        <div class="mal-gruppe mal-farben" id="mal-farben"></div>
        <div class="mal-gruppe">
          <label class="mal-label">eigene Farbe</label>
          <input type="color" id="mal-farbe-frei" value="#101020">
        </div>
        <div class="mal-gruppe mal-aktionen">
          <div class="mal-zurueck">
          <button type="button" class="btn klein wort" id="mal-undo" title="Rückgängig">Zurück</button>
          <button type="button" class="btn klein wort" id="mal-redo" title="Wiederholen">Vor</button>
          </div>
          <button type="button" class="btn klein secondary" id="mal-bild">Bild laden</button>
          <button type="button" class="btn klein secondary" id="mal-leeren">Leeren</button>
          <input type="file" id="mal-datei" accept="image/*" hidden>
        </div>
      </div>
      <div class="mal-flaeche"><canvas id="mal-canvas" width="${breite}" height="${hoehe}"></canvas></div>
    </div>`;

  const canvas = host.querySelector("#mal-canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const zustand = { werkzeug: "stift", farbe: "#101020", staerke: 6, strichart: "voll", gefuellt: false };
  let zeichnet = false, startP = null, letzteP = null, momentaufnahme = null;
  const historie = [], zukunft = [];

  const fuellHintergrund = () => { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, breite, hoehe); };
  fuellHintergrund();
  if (start) ladeBild(start);

  function merken() {
    historie.push(canvas.toDataURL("image/png"));
    if (historie.length > 25) historie.shift();
    zukunft.length = 0;
    knoepfe();
  }
  function knoepfe() {
    host.querySelector("#mal-undo").disabled = historie.length === 0;
    host.querySelector("#mal-redo").disabled = zukunft.length === 0;
  }
  function setzeAusDataUrl(url, stapel) {
    return new Promise((fertig) => {
      const bild = new Image();
      bild.onload = () => { ctx.clearRect(0, 0, breite, hoehe); fuellHintergrund(); ctx.drawImage(bild, 0, 0, breite, hoehe); fertig(); };
      bild.src = url;
    });
  }
  async function undo() { if (!historie.length) return; zukunft.push(canvas.toDataURL("image/png")); await setzeAusDataUrl(historie.pop()); knoepfe(); }
  async function redo() { if (!zukunft.length) return; historie.push(canvas.toDataURL("image/png")); await setzeAusDataUrl(zukunft.pop()); knoepfe(); }

  function ladeBild(quelle) {
    const bild = new Image();
    bild.onload = () => {
      merken();
      fuellHintergrund();
      const s = Math.min(breite / bild.width, hoehe / bild.height);   // ganz sichtbar, nichts abgeschnitten
      const w = bild.width * s, h = bild.height * s;
      ctx.drawImage(bild, (breite - w) / 2, (hoehe - h) / 2, w, h);
    };
    bild.src = quelle;
  }

  // ---- Werkzeugleiste
  host.querySelector("#mal-tools").innerHTML = WERKZEUGE
    .map((w) => `<button type="button" class="mal-tool${w.id === "stift" ? " aktiv" : ""}" data-tool="${w.id}" title="${w.name}">${w.icon}</button>`).join("");
  host.querySelector("#mal-strichart").innerHTML = STRICHARTEN
    .map((a) => `<button type="button" class="mal-tool schmal${a.id === "voll" ? " aktiv" : ""}" data-art="${a.id}" title="${a.name}"><span class="art-${a.id}"></span></button>`).join("");
  host.querySelector("#mal-farben").innerHTML = FARBEN
    .map((f) => `<button type="button" class="mal-farbe${f === "#101020" ? " aktiv" : ""}" data-farbe="${f}" style="background:${f}" title="${f}"></button>`).join("");

  host.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tool]");
    if (t) { zustand.werkzeug = t.dataset.tool; host.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("aktiv", b === t)); }
    const a = e.target.closest("[data-art]");
    if (a) { zustand.strichart = a.dataset.art; host.querySelectorAll("[data-art]").forEach((b) => b.classList.toggle("aktiv", b === a)); }
    const f = e.target.closest("[data-farbe]");
    if (f) { zustand.farbe = f.dataset.farbe; host.querySelector("#mal-farbe-frei").value = f.dataset.farbe; host.querySelectorAll("[data-farbe]").forEach((b) => b.classList.toggle("aktiv", b === f)); }
  });
  host.querySelector("#mal-staerke").addEventListener("input", (e) => {
    zustand.staerke = Number(e.target.value); host.querySelector("#mal-staerke-wert").textContent = e.target.value;
  });
  host.querySelector("#mal-gefuellt").addEventListener("change", (e) => { zustand.gefuellt = e.target.checked; });
  host.querySelector("#mal-farbe-frei").addEventListener("input", (e) => {
    zustand.farbe = e.target.value; host.querySelectorAll("[data-farbe]").forEach((b) => b.classList.remove("aktiv"));
  });
  host.querySelector("#mal-undo").addEventListener("click", undo);
  host.querySelector("#mal-redo").addEventListener("click", redo);
  host.querySelector("#mal-leeren").addEventListener("click", () => { merken(); fuellHintergrund(); });
  host.querySelector("#mal-bild").addEventListener("click", () => host.querySelector("#mal-datei").click());
  host.querySelector("#mal-datei").addEventListener("change", (e) => {
    const datei = e.target.files?.[0];
    if (datei) { const leser = new FileReader(); leser.onload = () => ladeBild(leser.result); leser.readAsDataURL(datei); }
    e.target.value = "";
  });
  knoepfe();

  // ---- Zeichnen
  const punkt = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * breite, y: ((ev.clientY - r.top) / r.height) * hoehe };
  };
  const stiftSetzen = () => {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.lineWidth = zustand.staerke;
    ctx.strokeStyle = zustand.werkzeug === "radierer" ? "#ffffff" : zustand.farbe;
    ctx.fillStyle = zustand.farbe;
    const art = STRICHARTEN.find((a) => a.id === zustand.strichart);
    ctx.setLineDash(zustand.werkzeug === "radierer" ? [] : art.dash.map((d) => d * Math.max(1, zustand.staerke / 6)));
  };

  canvas.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const p = punkt(ev);
    if (zustand.werkzeug === "pipette") { pipette(p); return; }
    if (zustand.werkzeug === "fuellen") { merken(); fuellen(p, zustand.farbe); return; }
    merken();
    zeichnet = true; startP = p; letzteP = p;
    canvas.setPointerCapture(ev.pointerId);
    momentaufnahme = ctx.getImageData(0, 0, breite, hoehe);
    if (zustand.werkzeug === "stift" || zustand.werkzeug === "radierer") {
      stiftSetzen(); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.01, p.y); ctx.stroke();
    }
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!zeichnet) return;
    const p = punkt(ev);
    if (zustand.werkzeug === "stift" || zustand.werkzeug === "radierer") {
      stiftSetzen(); ctx.beginPath(); ctx.moveTo(letzteP.x, letzteP.y); ctx.lineTo(p.x, p.y); ctx.stroke(); letzteP = p;
    } else { ctx.putImageData(momentaufnahme, 0, 0); form(startP, p); }
  });
  const beenden = (ev) => {
    if (!zeichnet) return;
    zeichnet = false;
    const p = punkt(ev);
    if (zustand.werkzeug !== "stift" && zustand.werkzeug !== "radierer") { ctx.putImageData(momentaufnahme, 0, 0); form(startP, p); }
    ctx.setLineDash([]);
  };
  canvas.addEventListener("pointerup", beenden);
  canvas.addEventListener("pointercancel", beenden);
  canvas.addEventListener("pointerleave", (ev) => { if (zeichnet) beenden(ev); });

  function form(a, b) {
    stiftSetzen();
    ctx.beginPath();
    if (zustand.werkzeug === "linie") { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); return; }
    if (zustand.werkzeug === "rechteck") ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    if (zustand.werkzeug === "ellipse")
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    if (zustand.gefuellt) ctx.fill();
    ctx.stroke();
  }

  function pipette(p) {
    const d = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
    const hex = "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    zustand.farbe = hex;
    host.querySelector("#mal-farbe-frei").value = hex;
    host.querySelectorAll("[data-farbe]").forEach((b) => b.classList.toggle("aktiv", b.dataset.farbe === hex));
  }

  /** Flächen füllen (Zeilenweise, mit kleiner Toleranz gegen weiche Kanten). */
  function fuellen(p, hex) {
    const bild = ctx.getImageData(0, 0, breite, hoehe);
    const d = bild.data;
    const x0 = Math.floor(p.x), y0 = Math.floor(p.y);
    if (x0 < 0 || y0 < 0 || x0 >= breite || y0 >= hoehe) return;
    const idx = (x, y) => (y * breite + x) * 4;
    const ziel = d.slice(idx(x0, y0), idx(x0, y0) + 4);
    const neu = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
    if (ziel.every((v, i) => v === neu[i])) return;
    const passt = (i) => Math.abs(d[i] - ziel[0]) + Math.abs(d[i + 1] - ziel[1]) + Math.abs(d[i + 2] - ziel[2]) + Math.abs(d[i + 3] - ziel[3]) < 60;
    const stapel = [[x0, y0]];
    while (stapel.length) {
      const [sx, sy] = stapel.pop();
      let x = sx;
      while (x >= 0 && passt(idx(x, sy))) x--;
      x++;
      let obenDrin = false, untenDrin = false;
      for (; x < breite && passt(idx(x, sy)); x++) {
        const i = idx(x, sy);
        d[i] = neu[0]; d[i + 1] = neu[1]; d[i + 2] = neu[2]; d[i + 3] = 255;
        if (sy > 0) { const o = passt(idx(x, sy - 1)); if (o && !obenDrin) stapel.push([x, sy - 1]); obenDrin = o; }
        if (sy < hoehe - 1) { const u = passt(idx(x, sy + 1)); if (u && !untenDrin) stapel.push([x, sy + 1]); untenDrin = u; }
      }
    }
    ctx.putImageData(bild, 0, 0);
  }

  return {
    canvas,
    /** PNG, bei Fotos automatisch JPEG, damit der Bogen klein bleibt. */
    alsDataUrl(maxBytes = 480 * 1024) {
      let url = canvas.toDataURL("image/png");
      if (url.length * 0.75 <= maxBytes) return url;
      for (const q of [0.9, 0.8, 0.7, 0.6, 0.5]) {
        url = canvas.toDataURL("image/jpeg", q);
        if (url.length * 0.75 <= maxBytes) break;
      }
      return url;
    },
    laden: ladeBild,
  };
}
