import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "./config";

mkdirSync(cfg.dataDir, { recursive: true });
const db = new Database(join(cfg.dataDir, "boegen.sqlite"), { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 4000;");
db.exec(`
  CREATE TABLE IF NOT EXISTS boegen (
    id TEXT PRIMARY KEY,
    besitzer_id INTEGER NOT NULL,
    besitzer_name TEXT NOT NULL,
    titel TEXT NOT NULL,
    design TEXT NOT NULL,
    daten TEXT NOT NULL,
    freigegeben INTEGER NOT NULL DEFAULT 0,
    erstellt TEXT NOT NULL,
    geaendert TEXT NOT NULL,
    portrait BLOB,
    portrait_typ TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_besitzer ON boegen (besitzer_id);
  CREATE INDEX IF NOT EXISTS idx_frei ON boegen (freigegeben, geaendert);
  CREATE TABLE IF NOT EXISTS freigaben (
    bogen_id TEXT NOT NULL,
    nutzer_id INTEGER NOT NULL,
    nutzer_name TEXT NOT NULL,
    PRIMARY KEY (bogen_id, nutzer_id)
  );
  CREATE INDEX IF NOT EXISTS idx_freigabe_nutzer ON freigaben (nutzer_id);
`);

export interface Bogen {
  id: string; besitzer_id: number; besitzer_name: string; titel: string;
  design: string; daten: string; freigegeben: number; erstellt: string; geaendert: string;
  portrait?: Uint8Array | null; portrait_typ?: string | null;
}
export const MAX_PRO_NUTZER = 50;
export const MAX_DATEN = 16 * 1024;
export const MAX_PORTRAIT = 500 * 1024;

const jetzt = () => new Date().toISOString();
export const neueId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

const OHNE_BILD = "id, besitzer_id, besitzer_name, titel, design, daten, freigegeben, erstellt, geaendert, (portrait IS NOT NULL) AS hat_portrait";

export const eigene = (uid: number) =>
  db.query<Bogen & { hat_portrait: number }, any>(`SELECT ${OHNE_BILD} FROM boegen WHERE besitzer_id = ? ORDER BY geaendert DESC`).all(uid);

export const freigegebene = (limit = 300) =>
  db.query<Bogen & { hat_portrait: number }, any>(`SELECT ${OHNE_BILD} FROM boegen WHERE freigegeben = 1 ORDER BY geaendert DESC LIMIT ?`).all(limit);

export const hole = (id: string) => db.query<Bogen, any>("SELECT * FROM boegen WHERE id = ?").get(id);

export const anzahlVon = (uid: number) =>
  (db.query<{ n: number }, any>("SELECT COUNT(*) AS n FROM boegen WHERE besitzer_id = ?").get(uid)?.n ?? 0);

export function speichere(b: Omit<Bogen, "erstellt" | "geaendert"> & { erstellt?: string }, portraitSetzen = false) {
  const t = jetzt();
  db.query(`INSERT INTO boegen (id, besitzer_id, besitzer_name, titel, design, daten, freigegeben, erstellt, geaendert, portrait, portrait_typ)
            VALUES ($id, $bid, $bname, $titel, $design, $daten, $frei, $erstellt, $geaendert, $portrait, $ptyp)
            ON CONFLICT(id) DO UPDATE SET besitzer_name = $bname, titel = $titel, design = $design,
              daten = $daten, freigegeben = $frei, geaendert = $geaendert`)
    .run({ $id: b.id, $bid: b.besitzer_id, $bname: b.besitzer_name, $titel: b.titel, $design: b.design,
           $daten: b.daten, $frei: b.freigegeben, $erstellt: b.erstellt ?? t, $geaendert: t,
           $portrait: b.portrait ?? null, $ptyp: b.portrait_typ ?? null });
  if (portraitSetzen)
    db.query("UPDATE boegen SET portrait = $p, portrait_typ = $t WHERE id = $id")
      .run({ $p: b.portrait ?? null, $t: b.portrait_typ ?? null, $id: b.id });
  return hole(b.id)!;
}

export const holePortrait = (id: string) =>
  db.query<{ portrait: Uint8Array | null; portrait_typ: string | null }, any>("SELECT portrait, portrait_typ FROM boegen WHERE id = ?").get(id);

export const loesche = (id: string) => {
  db.query("DELETE FROM freigaben WHERE bogen_id = ?").run(id);
  return db.query("DELETE FROM boegen WHERE id = ?").run(id).changes > 0;
};
export function loescheVonNutzer(uid: number) {
  db.query("DELETE FROM freigaben WHERE nutzer_id = ? OR bogen_id IN (SELECT id FROM boegen WHERE besitzer_id = ?)").run(uid, uid);
  return db.query("DELETE FROM boegen WHERE besitzer_id = ?").run(uid).changes;
}

// ---- gezielte Freigaben an einzelne Nutzer
export interface Freigabe { nutzer_id: number; nutzer_name: string }

export const freigabenVon = (bogenId: string) =>
  db.query<Freigabe, any>("SELECT nutzer_id, nutzer_name FROM freigaben WHERE bogen_id = ? ORDER BY nutzer_name").all(bogenId);

export function setzeFreigaben(bogenId: string, empfaenger: Freigabe[]) {
  const tx = db.transaction((liste: Freigabe[]) => {
    db.query("DELETE FROM freigaben WHERE bogen_id = ?").run(bogenId);
    const ein = db.query("INSERT OR REPLACE INTO freigaben (bogen_id, nutzer_id, nutzer_name) VALUES (?, ?, ?)");
    for (const e of liste.slice(0, 30)) ein.run(bogenId, e.nutzer_id, e.nutzer_name);
  });
  tx(empfaenger);
}

export const istFreigegebenFuer = (bogenId: string, uid: number) =>
  !!db.query("SELECT 1 FROM freigaben WHERE bogen_id = ? AND nutzer_id = ?").get(bogenId, uid);

/** Bögen, die jemand ausdrücklich mit mir geteilt hat. */
export const fuerMich = (uid: number) =>
  db.query<Bogen & { hat_portrait: number }, any>(
    `SELECT ${OHNE_BILD} FROM boegen WHERE id IN (SELECT bogen_id FROM freigaben WHERE nutzer_id = ?) ORDER BY geaendert DESC`).all(uid);
export const benenneUm = (uid: number, name: string) =>
  db.query("UPDATE boegen SET besitzer_name = ? WHERE besitzer_id = ? AND besitzer_name <> ?").run(name, uid, name).changes;

/** Sicherungskopie für das nächtliche Offsite-Backup. */
export function sichere() {
  const dir = join(cfg.dataDir, "backup");
  mkdirSync(dir, { recursive: true });
  const ziel = join(dir, "boegen.sqlite");
  try { db.exec(`VACUUM INTO '${ziel.replace(/'/g, "''")}.neu'`); } catch (e) { console.warn("Sicherung fehlgeschlagen:", String(e)); return; }
  try { Bun.spawnSync(["mv", `${ziel}.neu`, ziel]); } catch {}
}
