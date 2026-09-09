export type Gruppe = "handeln" | "wissen" | "soziales";
export interface Faehigkeit { n: string; p: number }
export interface Charakter {
  v: number; name: string; geschlecht: string; alter: string; statur: string; religion: string;
  beruf: string; familienstand: string; lebenspunkte: string; inventar: string; anmerkungen: string;
  handeln: Faehigkeit[]; wissen: Faehigkeit[]; soziales: Faehigkeit[];
}
export interface GruppenWerte { punkte: number; begabung: number; gbp: number; zeilen: { n: string; p: number; wert: number }[] }
export interface Werte { gruppen: Record<Gruppe, GruppenWerte>; ausgegeben: number; rest: number; warnungen: string[] }

export const GRUPPEN: Gruppe[];
export const GRUPPEN_LABEL: Record<Gruppe, string>;
export const PUNKTE_GESAMT: number;
export const MAX_ZEILEN: number;
export const MAX_FAEHIGKEIT: number;
export function leererCharakter(): Charakter;
export function gruppenPunkte(liste: Faehigkeit[]): number;
export function begabung(liste: Faehigkeit[]): number;
export function geistesblitz(begabungswert: number): number;
export function endwert(punkte: number, begabungswert: number): number;
export function berechne(ch: any): Werte;
export function restText(rest: number): string;
export function wuerfleCharakter(tabellen: any, opt?: { seed?: number; archetyp?: string }): Charakter;
