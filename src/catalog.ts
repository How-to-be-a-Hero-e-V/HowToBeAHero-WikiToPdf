import { cfg } from "./config";
import { categoryMembers, rawPage } from "./wiki";
import defaults from "../catalog.default.json";

export interface Group { id: string; name: string; category: string; members?: string[] }
export interface Sheet { id: string; name: string; file: string; description?: string }
export interface BookDef { title: string; rules?: "all" | string[]; modules?: string[]; adventures?: string[]; pages?: string[]; sheet?: string }
export interface Catalog {
  rulebook: { name: string; chapters: string[] };
  modules: { name: string; groups: Group[] };
  adventures: { name: string; groups: Group[] };
  sheets: Sheet[];
  books: Record<string, BookDef>;
  allowedNamespaces: number[];
  badgeFiles: string[];
}

const TTL = 10 * 60 * 1000;
let cached: { at: number; catalog: Catalog } | null = null;
let resolved: { at: number; catalog: Catalog } | null = null;

// Katalog: Vorgabe aus dem Repo, ueberschrieben durch die Wiki-Seite (von der Redaktion pflegbar).
export async function loadCatalog(): Promise<Catalog> {
  if (cached && Date.now() - cached.at < TTL) return cached.catalog;
  let catalog: Catalog = structuredClone(defaults) as Catalog;
  try {
    const raw = await rawPage(cfg.catalogPage);
    if (raw) catalog = { ...catalog, ...JSON.parse(raw) };
  } catch (e) {
    console.warn(`Katalogseite ${cfg.catalogPage} nicht lesbar, nutze Vorgabe:`, String(e));
  }
  cached = { at: Date.now(), catalog };
  return catalog;
}

// Katalog mit aufgeloesten Kategorien (fuer die Baukasten-Oberflaeche).
export async function resolvedCatalog(): Promise<Catalog> {
  if (resolved && Date.now() - resolved.at < TTL) return resolved.catalog;
  const base = structuredClone(await loadCatalog());
  for (const section of [base.modules, base.adventures]) {
    for (const g of section.groups) {
      const members = await categoryMembers(g.category);
      g.members = members.filter(m => m.ns === 0).map(m => m.title).sort((a, b) => a.localeCompare(b, "de"));
    }
  }
  resolved = { at: Date.now(), catalog: base };
  return base;
}

export function invalidateCatalog() { cached = null; resolved = null; }
