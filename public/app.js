import { BASE as base, $, esc as escape2, kopfleiste, anmeldeleiste, api } from "./common.js";
$("#kopf").innerHTML = kopfleiste("buch", "Buch-Baukasten", "Regelwerk, Module, Abenteuer und Charakterbogen: Klick dir zusammen, was deine Runde braucht, und nimm es als PDF mit an den Spieltisch.");
const me = await anmeldeleiste($("#anmeldung"));
(async function () {
  const cat = await (await fetch(base + "/api/catalog")).json();
  $("#loading").hidden = true; $("#form").hidden = false;
  $("#wikilink").href = cat.wiki;

  const item = (group, title) => `<label class="item"><input type="checkbox" name="${group}" value="${esc(title)}"><span>${esc(title)}</span></label>`;
  $("#rules").innerHTML = cat.rulebook.chapters.map(t => item("rules", t)).join("");
  for (const sec of ["modules", "adventures"]) {
    $("#" + sec).innerHTML = cat[sec].groups.map((g, i) => `<details class="group" ${i < 2 ? "open" : ""}>
      <summary>${esc(g.name)} <span class="cnt">(${g.members.length})</span> <a href="#" class="quick" data-all="${sec}" data-group="${g.id}">alle</a></summary>
      <div class="grid">${g.members.map(t => item(sec, t)).join("") || "<em>keine Einträge</em>"}</div></details>`).join("");
  }
  $("#sheets").innerHTML = `<label class="item sel"><input type="radio" name="sheet" value="" checked><span><b>Kein Charakterbogen</b></span></label>` +
    cat.sheets.map(s => `<label class="item"><input type="radio" name="sheet" value="${esc(s.id)}"><span><b>${esc(s.name)}</b><span class="desc">${esc(s.description || "")}</span></span></label>`).join("");

  // Gespeicherte Charakterbögen zum Mitnehmen ins Buch
  try {
    const { eigene, fuerMich, freigegeben } = await api("/api/boegen");
    const alle = [...(eigene ?? []), ...(fuerMich ?? []), ...(freigegeben ?? [])];
    $("#eigenebogen").innerHTML = alle.length
      ? alle.map(b => `<label class="item"><input type="checkbox" name="boegen" value="${escape2(b.id)}">` +
          `<span><b>${escape2(b.titel)}</b><span class="desc">${escape2(b.besitzer)}${b.eigener ? " · eigener" : ""}</span></span></label>`).join("")
      : `<p class="hinweis">${me.angemeldet ? "Noch keine gespeicherten Bögen. Leg im Charakterbogen-Editor einen an." : "Melde dich im Wiki an, dann kannst du hier eigene und freigegebene Bögen mitnehmen."}</p>`;
  } catch { $("#eigenebogen").innerHTML = ""; }

  // Vorbelegung aus der URL (geteilte Links)
  const q = new URLSearchParams(location.search);
  const preset = (name, val) => { const set = new Set((val || "").split("|").filter(Boolean).map(s => s.replace(/_/g, " ").toLowerCase())); document.querySelectorAll(`input[name=${name}]`).forEach(i => { i.checked = set.has(i.value.toLowerCase()); }); };
  if (q.get("rules") === "all") document.querySelectorAll("input[name=rules]").forEach(i => i.checked = true); else if (q.has("rules")) preset("rules", q.get("rules"));
  if (q.has("modules")) preset("modules", q.get("modules"));
  if (q.has("adventures")) preset("adventures", q.get("adventures"));
  if (q.has("pages")) $("#pages").value = q.get("pages");
  if (q.has("sheet")) { const r = document.querySelector(`input[name=sheet][value="${q.get("sheet")}"]`); if (r) r.checked = true; }
  if (q.get("fmt") === "a5") document.querySelector("input[name=fmt][value=a5]").checked = true;
  if (q.has("title")) $("#title").value = q.get("title");
  if (![...q.keys()].length) document.querySelectorAll("input[name=rules]").forEach(i => i.checked = true);
  document.querySelectorAll("#sheets label").forEach(l => l.classList.toggle("sel", l.querySelector("input").checked));

  document.addEventListener("click", e => {
    const a = e.target.closest("a[data-all],a[data-none]");
    if (!a) return;
    e.preventDefault();
    const name = a.dataset.all || a.dataset.none, on = "all" in a.dataset;
    const scope = a.dataset.group ? a.closest("details") : document;
    scope.querySelectorAll(`input[name=${name}]`).forEach(i => i.checked = on);
    update();
  });
  document.addEventListener("change", e => {
    if (e.target.name === "sheet") document.querySelectorAll("#sheets label").forEach(l => l.classList.toggle("sel", l.querySelector("input").checked));
    update();
  });
  $("#pages").addEventListener("input", update);

  function collect() {
    const vals = n => [...document.querySelectorAll(`input[name=${n}]:checked`)].map(i => i.value);
    const rules = vals("rules");
    const p = new URLSearchParams();
    if (rules.length === cat.rulebook.chapters.length) p.set("rules", "all"); else if (rules.length) p.set("rules", rules.join("|"));
    const modules = vals("modules"), adventures = vals("adventures");
    if (modules.length) p.set("modules", modules.join("|"));
    if (adventures.length) p.set("adventures", adventures.join("|"));
    const pages = $("#pages").value.split("|").map(s => s.trim()).filter(Boolean);
    if (pages.length) p.set("pages", pages.join("|"));
    const sheet = document.querySelector("input[name=sheet]:checked").value;
    if (sheet) p.set("sheet", sheet);
    const boegen = vals("boegen");
    if (boegen.length) p.set("boegen", boegen.join("|"));
    p.set("fmt", document.querySelector("input[name=fmt]:checked").value);
    if ($("#title").value.trim()) p.set("title", $("#title").value.trim());
    return { p, count: rules.length + modules.length + adventures.length + pages.length, sheet, boegen };
  }
  function update() {
    const { count, sheet, boegen } = collect();
    const zusatz = [sheet ? "leerer Bogen" : "", boegen.length ? `${boegen.length} Charakterbogen${boegen.length === 1 ? "" : "\u00f6gen"}` : ""].filter(Boolean).join(" und ");
    $("#summary").textContent = count
      ? `${count} Seite${count === 1 ? "" : "n"} ausgewählt${zusatz ? ` plus ${zusatz}` : ""}${count > cat.maxTitles ? ` – höchstens ${cat.maxTitles} möglich` : ""}.`
      : (zusatz ? `Nur ${zusatz}.` : "Noch nichts ausgewählt.");
    $("#go").disabled = (!count && !sheet && !boegen.length) || count > cat.maxTitles;
  }
  update();

  $("#share").addEventListener("click", async () => {
    const { p } = collect();
    const url = `${location.origin}${base}/book?${p}`;
    try { await navigator.clipboard.writeText(url); $("#status").textContent = "Link kopiert: " + url; }
    catch { $("#status").textContent = url; }
  });

  $("#form").addEventListener("submit", async e => {
    e.preventDefault();
    const { p } = collect();
    history.replaceState(null, "", `${base}/?${p}`);
    $("#go").disabled = true; $("#result").hidden = true; $("#bar").hidden = false; $("#fill").style.width = "3%";
    $("#status").textContent = "Auftrag wird angelegt …";
    let n = 0;
    try {
      const r = await fetch(base + "/api/jobs", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: p.toString() });
      if (!r.ok) throw new Error(await r.text());
      const job = await r.json();
      const poll = async () => {
        n++;
        const j = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
        $("#status").textContent = j.message || "";
        $("#fill").style.width = Math.min(95, 3 + n * 4) + "%";
        if (j.state === "done") {
          $("#fill").style.width = "100%";
          const a = $("#dlink"); a.href = `${base}/api/jobs/${job.id}/download`; a.textContent = `${job.file} herunterladen`;
          $("#result").hidden = false; $("#status").textContent = "Fertig. Teilen-Link: " + job.share; $("#go").disabled = false;
          return;
        }
        if (j.state === "error") throw new Error(j.error || "unbekannter Fehler");
        setTimeout(poll, 1500);
      };
      poll();
    } catch (err) {
      $("#status").textContent = "Fehler: " + err.message; $("#bar").hidden = true; $("#go").disabled = false;
    }
  });
  function esc(s) { return escape2(s); }
})();
