import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { makeEvent, redactMessage, telemetrySchema } from "../src/logging/events.js";
import { logConfig, parseInsertResult } from "../src/logging/bigquery.js";
import { ChatLogQueue } from "../src/logging/queue.js";

const event = () => makeEvent({ chat_id: "a".repeat(32), request_id: "b".repeat(24), environment: "local", chat_language: "uk", chat_context: "hotel" },
  { event_type: "user_message", role: "user", message: "Львів 08.11.2026, 3000 грн. +380 (67) 123-45-67 test@example.com" });

it("masks sensitive patterns before storage while preserving dates and budgets", () => {
  const row = event();
  assert.match(row.message!, /08\.11\.2026, 3000 грн/);
  assert.doesNotMatch(row.message!, /123-45-67|test@example/);
  assert.equal(redactMessage("Bearer secret-value"), "Bearer [СЕКРЕТ]");
  assert.equal(redactMessage("sk-12345678901234567890"), "[СЕКРЕТ]");
  assert.equal(row.input_tokens, null);
});

it("validates paths and destination identifiers", () => {
  assert.throws(() => logConfig({ CHAT_LOG_ENABLED: "true", CHAT_LOG_QUEUE_DIR: "relative" }), /absolute path/);
  assert.throws(() => logConfig({ CHAT_LOG_ENABLED: "true", BIGQUERY_TABLE_ID: "events/path" }), /destination/);
  assert.equal(logConfig({ CHAT_LOG_ENABLED: "true", CHAT_LOG_QUEUE_DIR: "/tmp/queue" })?.project, "map-hotels");
  assert.equal(telemetrySchema.safeParse({ chat_id: "../../etc/passwd" }).success, false);
  assert.equal(telemetrySchema.parse({ chat_id: "a".repeat(32), language: "en", token: "secret" }).language, "en");
  assert.equal("token" in telemetrySchema.parse({ chat_id: "a".repeat(32), token: "secret" }), false);
});

it("autodetects a key, uses tracked defaults, and respects explicit overrides", () => {
  const cwd = resolve("/app"), home = resolve("/home/service");
  const localKey = resolve(cwd,"secrets/bigquery.json");
  const paths = { cwd, home, hasFile: (file: string) => file === localKey };
  const config = logConfig({ NODE_ENV: "production" }, paths)!;
  assert.equal(config.project, "map-hotels");
  assert.equal(config.credentialsFile, localKey);
  assert.equal(config.directory, resolve(home,".local/state/hotels24-chat/queue"));
  assert.equal(config.environment, "prod");
  assert.equal(logConfig({ CHAT_LOG_ENABLED: "false" }, paths), undefined);
  assert.equal(logConfig({}, { ...paths, hasFile: () => false }), undefined);
  assert.equal(logConfig({}, { ...paths, hasFile: (file) => file === "/app/config/google-service-account.json" }), undefined);
  assert.equal(logConfig({}, { ...paths, hasFile: () => true })?.credentialsFile, localKey);
  assert.equal(logConfig({}, { ...paths, hasFile: (file) => file.startsWith("/etc/") })?.credentialsFile, "/etc/hotels24-chat/bigquery.json");
  assert.equal(logConfig({ GOOGLE_APPLICATION_CREDENTIALS: "/override.json" }, paths)?.credentialsFile, resolve(cwd,"/override.json"));
  assert.equal(logConfig({ CHAT_LOG_ENABLED: "true" }, { ...paths, hasFile: () => false })?.credentialsFile, undefined);
  assert.throws(() => logConfig({ CHAT_LOG_ENABLED: "yes" }, paths), /CHAT_LOG_ENABLED/);
});

it("recognizes partial failures and rejects malformed acknowledgements", () => {
  assert.deepEqual(parseInsertResult({}, 2), { failed: [] });
  assert.deepEqual(parseInsertResult({ insertErrors: [{ index: 1, errors: [{ reason: "invalid" }] }] }, 2), { failed: [1], reasons: ["invalid"] });
  assert.throws(() => parseInsertResult({ insertErrors: [{ index: 9 }] }, 2));
  assert.throws(() => parseInsertResult({ error: {} }, 2));
  assert.throws(() => parseInsertResult(null, 2));
});

it("survives restart, retains failures, and retries with the same event ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "h24-queue-"));
  try {
    const row = event();
    const messages: string[] = [];
    const report = (name: string) => { messages.push(name); };
    const first = new ChatLogQueue(directory, async () => { throw new Error("bigquery_http_403"); }, report);
    assert.equal(await first.enqueue(row), true);
    await first.flush(); await first.close();
    assert.equal((await readdir(directory)).length, 1);
    assert.doesNotMatch(await readFile(join(directory, (await readdir(directory))[0]!), "utf8"), /test@example/);
    const second = new ChatLogQueue(directory, async (rows) => {
      assert.equal(rows[0]?.event_id, row.event_id);
      return { failed: [] };
    }, report);
    await second.flush(); await second.close();
    assert.deepEqual(await readdir(directory), []);
    assert.ok(messages.includes("chat_log_delivery_failed"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("removes only acknowledged records on a partial insert", async () => {
  const directory = await mkdtemp(join(tmpdir(), "h24-partial-"));
  try {
    let attempt = 0;
    const first = event(), second = event();
    const queue = new ChatLogQueue(directory, async (rows) => {
      if (++attempt === 1) { assert.equal(rows.length, 2); return { failed: [1] }; }
      assert.equal(rows.length, 1); assert.equal(rows[0]?.event_id, second.event_id);
      return { failed: [] };
    }, () => {});
    await Promise.all([queue.enqueue(first), queue.enqueue(second)]);
    await Promise.all([queue.flush(), queue.flush()]);
    assert.equal(attempt, 1);
    assert.equal((await readdir(directory)).length, 1);
    await queue.flush(); await queue.close();
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("keeps chat available on storage failure and does not print sensitive errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "h24-disk-"));
  try {
    const path = join(directory, "file");
    await writeFile(path, "not a directory");
    const logs: unknown[] = [];
    const queue = new ChatLogQueue(path, async () => ({ failed: [] }), (...args) => logs.push(args));
    assert.equal(await queue.enqueue(event()), false);
    await queue.close();
    assert.match(JSON.stringify(logs), /chat_log_disk_error/);
    assert.doesNotMatch(JSON.stringify(logs), /example|Львів/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("recovers interrupted writes, expires stale rows, and skips damaged rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "h24-recovery-"));
  try {
    const row = event();
    const old = event();
    const corrupt = `${Date.now()}-${event().event_id}.json`;
    await writeFile(join(directory, `${Date.now()}-${row.event_id}.json.tmp`), JSON.stringify(row));
    await writeFile(join(directory, `${Date.now() - 8 * 86400000}-${old.event_id}.json`), JSON.stringify(old));
    await writeFile(join(directory, corrupt), "{");
    const logs: string[] = [];
    const queue = new ChatLogQueue(directory, async (rows) => {
      assert.equal(rows.length, 1); assert.equal(rows[0]?.event_id, row.event_id);
      return { failed: [] };
    }, (name) => { logs.push(name); });
    await queue.flush(); await queue.close();
    assert.deepEqual(await readdir(directory), [corrupt]);
    assert.ok(logs.includes("chat_log_corrupt_record"));
    assert.ok(logs.includes("chat_log_expired"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
