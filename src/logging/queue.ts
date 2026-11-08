import { mkdir, readdir, readFile, open, rename, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ChatEvent } from "./events.js";
import type { EventWriter } from "./bigquery.js";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 10000;
const RETENTION_MS = 7 * 86400000;
const filenamePattern = /^\d{13}-[a-f0-9-]{36}\.json$/;
type Report = (event: string, fields: Record<string, string | number>) => void;

/** One process per directory. Fail-open on disk errors/capacity; only acknowledged
 * rows are removed (except the explicit seven-day local retention limit). */
export class ChatLogQueue {
  private readonly pending = new Map<string, number>();
  private bytes = 0;
  private serial: Promise<unknown> = Promise.resolve();
  private flushing?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private failures = 0;
  private closed = false;
  private initialized = false;

  constructor(private readonly directory: string, private readonly writer: EventWriter,
    private readonly report: Report = (event, fields) => console.log(JSON.stringify({ event, ...fields }))) {}

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    const entries = new Map<string, number>();
    let bytes = 0;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) {
      // Recover complete rows left between fsync and rename by an interrupted process.
      if (name.endsWith(".tmp") && filenamePattern.test(name.slice(0, -4))) {
        const target = name.slice(0, -4);
        await rename(join(this.directory, name), join(this.directory, target));
        const info = await stat(join(this.directory, target));
        entries.set(target, info.size);
        continue;
      }
      if (!filenamePattern.test(name)) continue;
      const info = await stat(join(this.directory, name));
      entries.set(name, info.size);
    }
    for (const size of entries.values()) bytes += size;
    for (const [name, size] of entries) this.pending.set(name, size);
    this.bytes = bytes;
    this.initialized = true;
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const task = this.serial.then(work);
    this.serial = task.catch(() => undefined);
    return task;
  }

  async enqueue(event: ChatEvent): Promise<boolean> {
    try {
      return await this.exclusive(async () => {
        await this.initialize();
        const data = JSON.stringify(event);
        const size = Buffer.byteLength(data);
        if (this.pending.size >= MAX_FILES || this.bytes + size > MAX_BYTES) {
          this.report("chat_log_queue_full", { pending: this.pending.size });
          return false;
        }
        const name = `${Date.now()}-${event.event_id}.json`;
        const target = join(this.directory, name);
        const temp = target + ".tmp";
        try {
          const file = await open(temp, "wx", 0o600);
          try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
          await rename(temp, target);
          this.pending.set(name, size); this.bytes += size;
          const dir = await open(this.directory, "r");
          try { await dir.sync(); } finally { await dir.close(); }
        } catch (error) {
          await unlink(temp).catch(() => undefined);
          throw error;
        }
        return true;
      });
    } catch {
      this.report("chat_log_disk_error", { operation: "enqueue" });
      return false;
    }
  }

  start(): void { if (!this.timer && !this.closed) this.schedule(1000); }
  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().finally(() => {
        if (!this.closed) this.schedule(this.failures ? Math.min(300000, 5000 * 2 ** Math.min(this.failures, 6)) + Math.random() * 1000 : 5000);
      });
    }, delay);
    this.timer.unref();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.drain().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }

  private async remove(name: string): Promise<void> {
    await unlink(join(this.directory, name));
    this.bytes -= this.pending.get(name) || 0;
    this.pending.delete(name);
  }

  private async drain(): Promise<void> {
    try {
      const batch = await this.exclusive(async () => {
        await this.initialize();
        const rows: Array<{ name: string; event: ChatEvent }> = [];
        let expired = 0;
        for (const name of this.pending.keys()) {
          if (Number(name.slice(0, 13)) < Date.now() - RETENTION_MS) {
            await this.remove(name); expired += 1; continue;
          }
          try {
            const event = JSON.parse(await readFile(join(this.directory, name), "utf8")) as ChatEvent;
            if (!event.event_id || !event.chat_id || !event.created_at) throw new Error("invalid_row");
            rows.push({ name, event });
          } catch {
            // Keep damaged rows within the same size/retention bounds for inspection.
            this.report("chat_log_corrupt_record", { count: 1 });
          }
          if (rows.length === 100) break;
        }
        if (expired) this.report("chat_log_expired", { count: expired });
        return rows;
      });
      if (!batch.length) { this.failures = 0; return; }
      const { failed, reasons } = await this.writer(batch.map((row) => row.event));
      const rejected = new Set(failed);
      await this.exclusive(async () => {
        for (let i = 0; i < batch.length; i++) {
          const row = batch[i]!;
          if (!rejected.has(i)) await this.remove(row.name);
          else {
            // Retry behind other records so a malformed row cannot starve new events.
            const size = this.pending.get(row.name)!;
            this.pending.delete(row.name); this.pending.set(row.name, size);
          }
        }
      });
      this.failures = failed.length ? this.failures + 1 : 0;
      this.report("chat_log_delivery", { sent: batch.length - rejected.size, failed: rejected.size, pending: this.pending.size, reasons: (reasons || []).join(",") });
    } catch (error) {
      this.failures += 1;
      const code = error instanceof Error && /^bigquery_(?:auth_failed|transport_failed|invalid_response|http_\d{3})$/.test(error.message)
        ? error.message : "queue_io_error";
      this.report("chat_log_delivery_failed", { code, pending: this.pending.size });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.serial;
  }
}
