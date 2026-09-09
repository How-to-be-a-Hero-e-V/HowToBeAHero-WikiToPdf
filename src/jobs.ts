import { cfg } from "./config";
import { buildBook, resolve, type BookSpec } from "./book";

export interface Job { id: string; key: string; spec: BookSpec; besitzer?: number | null; nutzerRef?: { id: number; gruppen: string[] } | null; state: "queued" | "running" | "done" | "error"; message: string; path?: string; error?: string; created: number; finished?: number }

const jobs = new Map<string, Job>();
const byKey = new Map<string, Job>();
const queue: Job[] = [];
let running = 0;

export class TooBusy extends Error {}

export async function submit(spec: BookSpec, nutzer?: { id: number; gruppen: string[] } | null): Promise<Job> {
  const r = await resolve(spec, nutzer);
  const existing = byKey.get(r.key);
  if (existing && existing.state !== "error") return existing;
  if (queue.length >= cfg.queueMax) throw new TooBusy("Zu viele Aufträge in der Warteschlange, bitte gleich noch einmal versuchen.");
  const job: Job = { id: crypto.randomUUID(), key: r.key, spec, besitzer: r.privat ? (nutzer?.id ?? null) : null, nutzerRef: nutzer ?? null, state: "queued", message: "In der Warteschlange", created: Date.now() };
  jobs.set(job.id, job); byKey.set(r.key, job);
  queue.push(job);
  void pump();
  return job;
}

export function get(id: string) { return jobs.get(id); }

async function pump() {
  while (running < cfg.concurrency && queue.length) {
    const job = queue.shift()!;
    running++;
    job.state = "running"; job.message = "Wird vorbereitet …";
    (async () => {
      try {
        const r = await resolve(job.spec, job.nutzerRef ?? null);
        const res = await buildBook(r, m => { job.message = m; });
        job.path = res.path; job.state = "done"; job.message = res.cached ? "Aus dem Zwischenspeicher" : "Fertig";
      } catch (e: any) {
        job.state = "error"; job.error = e?.message ?? String(e); job.message = "Fehler";
        console.error(`Job ${job.id} fehlgeschlagen:`, e);
      } finally {
        job.finished = Date.now(); running--; void pump();
      }
    })();
  }
}

// Alte Auftraege vergessen
setInterval(() => {
  const cutoff = Date.now() - 6 * 3600e3;
  for (const [id, j] of jobs) if (j.finished && j.finished < cutoff) { jobs.delete(id); if (byKey.get(j.key) === j) byKey.delete(j.key); }
}, 600e3);

// Einfaches Rate-Limit pro IP
const buckets = new Map<string, number[]>();
export function allow(ip: string): boolean {
  const now = Date.now();
  const arr = (buckets.get(ip) ?? []).filter(t => now - t < 60e3);
  if (arr.length >= cfg.jobsPerMinute) { buckets.set(ip, arr); return false; }
  arr.push(now); buckets.set(ip, arr);
  return true;
}
