// Regeln der Charaktererstellung. Wird vom Server und vom Browser genutzt.
// Quelle: Regelwerk "Rechnerische Charaktererstellung", "Begabungen", "Geistesblitzpunkte".

export const GRUPPEN = /** @type {const} */ (["handeln", "wissen", "soziales"]);
export const GRUPPEN_LABEL = { handeln: "Handeln", wissen: "Wissen", soziales: "Soziales" };
export const PUNKTE_GESAMT = 400;
export const MAX_ZEILEN = 10;      // so viele Zeilen hat der Bogen je Gruppe
export const MAX_FAEHIGKEIT = 100; // keine Fähigkeit über 100

const round = (n) => Math.round(n); // kaufmännisch, Werte sind immer positiv

export function leererCharakter() {
  return {
    v: 1, name: "", geschlecht: "", alter: "", statur: "", religion: "", beruf: "",
    familienstand: "", lebenspunkte: "100", inventar: "", anmerkungen: "",
    handeln: [], wissen: [], soziales: [],
  };
}

/** Punkte einer Gruppe, nur gültige Zeilen zählen. */
export function gruppenPunkte(liste) {
  return (liste ?? []).reduce((a, f) => a + (Number(f?.p) > 0 ? Math.floor(Number(f.p)) : 0), 0);
}

export function begabung(liste) {
  return round(gruppenPunkte(liste) / 10);
}

export function geistesblitz(begabungswert) {
  return round(begabungswert / 10);
}

/** Endwert einer Fähigkeit: eingesetzte Punkte plus Begabungswert, gedeckelt bei 100. */
export function endwert(punkte, begabungswert) {
  return Math.min(MAX_FAEHIGKEIT, Math.floor(Number(punkte) || 0) + begabungswert);
}

/** Alles, was der Bogen anzeigt, aus den eingegebenen Punkten berechnet. */
export function berechne(ch) {
  const out = { gruppen: {}, ausgegeben: 0, rest: 0, warnungen: [] };
  for (const g of GRUPPEN) {
    const liste = (ch[g] ?? []).filter((f) => f && (f.n?.trim() || Number(f.p) > 0));
    const punkte = gruppenPunkte(liste);
    const beg = round(punkte / 10);
    const zeilen = liste.map((f) => {
      const p = Math.floor(Number(f.p) || 0);
      const w = endwert(p, beg);
      if (p + beg > MAX_FAEHIGKEIT) out.warnungen.push(`${f.n || "Fähigkeit"} käme auf ${p + beg} und wird bei 100 gedeckelt.`);
      return { n: (f.n ?? "").trim(), p, wert: w };
    });
    out.gruppen[g] = { punkte, begabung: beg, gbp: geistesblitz(beg), zeilen };
    out.ausgegeben += punkte;
    if (liste.length > MAX_ZEILEN) out.warnungen.push(`${GRUPPEN_LABEL[g]}: nur ${MAX_ZEILEN} Fähigkeiten passen auf den Bogen.`);
  }
  out.rest = PUNKTE_GESAMT - out.ausgegeben;
  if (out.rest < 0) out.warnungen.push(`${-out.rest} Punkte zu viel vergeben (${PUNKTE_GESAMT} sind vorgesehen).`);
  return out;
}

/** Kurzer Text für die Fußzeile des Bogens. */
export function restText(rest) {
  if (rest === 0) return "alle Punkte vergeben";
  if (rest > 0) return `${rest} Punkte übrig`;
  return `${-rest} Punkte zu viel`;
}

// ---------------------------------------------------------------- Zufall

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
function ziehe(rnd, arr, n) {
  const rest = [...new Set(arr)];
  const out = [];
  while (out.length < n && rest.length) out.push(...rest.splice(Math.floor(rnd() * rest.length), 1));
  return out;
}

/**
 * Baut einen plausiblen Charakter: ein Archetyp gibt Beruf und Fähigkeiten vor,
 * die 400 Punkte werden gewichtet verteilt und in Fünferschritten gerundet.
 */
export function wuerfleCharakter(tabellen, opt = {}) {
  const rnd = mulberry32(opt.seed ?? (Math.random() * 2 ** 32) >>> 0);
  const arche = opt.archetyp
    ? tabellen.archetypen.find((a) => a.id === opt.archetyp) ?? pick(rnd, tabellen.archetypen)
    : pick(rnd, tabellen.archetypen);
  const ch = leererCharakter();
  const geschlecht = pick(rnd, tabellen.geschlechter ?? ["weiblich", "männlich", "divers"]);
  const namensliste = tabellen.vornamen[geschlecht] ?? tabellen.vornamen.neutral ?? [];
  ch.name = `${pick(rnd, namensliste.length ? namensliste : ["Alex"])} ${pick(rnd, tabellen.nachnamen)}`;
  ch.geschlecht = geschlecht;
  ch.alter = String(18 + Math.floor(rnd() * 42));
  ch.statur = pick(rnd, tabellen.statur);
  ch.religion = pick(rnd, tabellen.religion);
  ch.beruf = pick(rnd, arche.berufe ?? [arche.name]);
  ch.familienstand = pick(rnd, tabellen.familienstand);
  ch.lebenspunkte = "100";
  ch.inventar = ziehe(rnd, arche.inventar ?? tabellen.inventar ?? [], 4).join(", ");
  ch.anmerkungen = `${arche.name}. ${pick(rnd, tabellen.eigenheiten)}`;

  // Punkte auf die Gruppen verteilen, danach auf die Fähigkeiten
  const gew = GRUPPEN.map((g) => (arche.gewichte?.[g] ?? 1) * (0.85 + rnd() * 0.3));
  const summe = gew.reduce((a, b) => a + b, 0);
  const proGruppe = gew.map((w) => Math.round((PUNKTE_GESAMT * w) / summe / 5) * 5);
  proGruppe[0] += PUNKTE_GESAMT - proGruppe.reduce((a, b) => a + b, 0);

  GRUPPEN.forEach((g, gi) => {
    const budget = proGruppe[gi];
    const beg = round(budget / 10);                       // Begabung steht mit dem Gruppenbudget fest
    const maxP = Math.max(25, Math.min(75, MAX_FAEHIGKEIT - beg));
    const minP = 20;
    const minAnzahl = Math.max(2, Math.ceil(budget / maxP));
    const maxAnzahl = Math.min(MAX_ZEILEN, Math.floor(budget / minP));
    const anzahl = Math.max(minAnzahl, Math.min(maxAnzahl, 3 + Math.floor(rnd() * 4)));
    const pool = [...(arche.faehigkeiten?.[g] ?? []), ...(tabellen.faehigkeiten?.[g] ?? [])];
    const namen = ziehe(rnd, pool, anzahl);
    const punkte = namen.map(() => minP);
    let offen = budget - minP * namen.length;
    while (offen >= 5) {                                  // Rest in Fünferschritten verteilen
      const frei = punkte.map((p, i) => (p + 5 <= maxP ? i : -1)).filter((i) => i >= 0);
      if (!frei.length) break;
      punkte[pick(rnd, frei)] += 5;
      offen -= 5;
    }
    if (offen > 0 && punkte.length) punkte[0] += offen;
    ch[g] = namen.map((n, i) => ({ n, p: punkte[i] }));
  });

  // Nach der Begabung prüfen, dass keine Fähigkeit über 100 landet; frei werdende Punkte umverteilen
  for (const g of GRUPPEN) {
    for (let runde = 0; runde < 6; runde++) {
      const beg = begabung(ch[g]);
      let frei = 0;
      for (const f of ch[g]) if (f.p + beg > MAX_FAEHIGKEIT) { frei += f.p - (MAX_FAEHIGKEIT - beg); f.p = MAX_FAEHIGKEIT - beg; }
      if (!frei) break;
      const platz = ch[g].filter((f) => f.p + beg < MAX_FAEHIGKEIT - 5);
      if (!platz.length) break;
      for (let i = 0; frei >= 5 && i < platz.length * 20; i++) { platz[i % platz.length].p += 5; frei -= 5; }
    }
  }
  return ch;
}
