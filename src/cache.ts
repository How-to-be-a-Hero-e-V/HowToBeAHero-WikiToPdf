import { cfg } from "./config";
import { mkdir, readdir, stat, unlink, rename } from "node:fs/promises";
import { join } from "node:path";

const dir = join(cfg.dataDir, "cache");
await mkdir(dir, { recursive: true });

export function cachePath(key: string) { return join(dir, `${key}.pdf`); }

export async function cacheGet(key: string): Promise<string | null> {
  const p = cachePath(key);
  try { await stat(p); return p; } catch { return null; }
}

export async function cachePut(key: string, bytes: Uint8Array): Promise<string> {
  const p = cachePath(key);
  const tmp = `${p}.${process.pid}.tmp`;
  await Bun.write(tmp, bytes);
  await rename(tmp, p);
  void prune();
  return p;
}

// Aeltere Dateien entfernen: nach Alter und nach Gesamtgroesse.
export async function prune() {
  try {
    const files = await readdir(dir);
    const entries: { p: string; size: number; mtime: number }[] = [];
    for (const f of files) {
      if (!f.endsWith(".pdf")) continue;
      const p = join(dir, f); const s = await stat(p);
      entries.push({ p, size: s.size, mtime: s.mtimeMs });
    }
    const cutoff = Date.now() - cfg.cacheMaxAgeDays * 86400e3;
    let total = entries.reduce((a, e) => a + e.size, 0);
    entries.sort((a, b) => a.mtime - b.mtime);
    for (const e of entries) {
      if (e.mtime < cutoff || total > cfg.cacheMaxBytes) { await unlink(e.p).catch(() => {}); total -= e.size; }
    }
  } catch (e) { console.warn("Cache-Aufraeumen fehlgeschlagen:", String(e)); }
}

/** Kompletten Buch-Zwischenspeicher leeren, etwa wenn ein enthaltener Bogen verschwindet. */
export async function pruneAll() {
  try {
    for (const f of await readdir(dir)) if (f.endsWith(".pdf")) await unlink(join(dir, f)).catch(() => {});
  } catch (e) { console.warn("Zwischenspeicher leeren fehlgeschlagen:", String(e)); }
}
