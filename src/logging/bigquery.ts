import { GoogleAuth } from "google-auth-library";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { ChatEvent } from "./events.js";
import { chatLogSettings } from "./settings.js";

export interface InsertResult { failed: number[]; reasons?: string[] }
export type EventWriter = (events: ChatEvent[]) => Promise<InsertResult>;
export interface LogConfig {
  project: string; dataset: string; table: string; directory: string;
  environment: "prod" | "stage" | "local";
  credentialsFile?: string;
}

interface ConfigPaths { cwd: string; home: string; hasFile: (file: string) => boolean }

export function logConfig(env: NodeJS.ProcessEnv = process.env, paths: ConfigPaths = {
  cwd: process.cwd(), home: homedir(), hasFile: existsSync,
}): LogConfig | undefined {
  const enabled = env.CHAT_LOG_ENABLED || chatLogSettings.enabled;
  if (enabled === "false") return undefined;
  if (!["auto", "true"].includes(enabled)) throw new Error("CHAT_LOG_ENABLED must be auto, true or false");
  const candidates = [
    resolve(paths.cwd, chatLogSettings.credentialsFile),
    chatLogSettings.externalCredentialsFile,
  ];
  const credentialsFile = env.GOOGLE_APPLICATION_CREDENTIALS
    ? resolve(paths.cwd, env.GOOGLE_APPLICATION_CREDENTIALS)
    : candidates.find((file) => paths.hasFile(file));
  if (enabled === "auto" && !credentialsFile) return undefined;
  const project = env.BIGQUERY_PROJECT_ID || chatLogSettings.project;
  const dataset = env.BIGQUERY_DATASET_ID || chatLogSettings.dataset;
  const table = env.BIGQUERY_TABLE_ID || chatLogSettings.table;
  const directory = env.CHAT_LOG_QUEUE_DIR || resolve(paths.home, chatLogSettings.queueDirectory);
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) ||
      !/^\w{1,1024}$/.test(dataset) || !/^\w{1,1024}$/.test(table)) {
    throw new Error("Invalid BigQuery destination configuration");
  }
  if (!isAbsolute(directory)) throw new Error("CHAT_LOG_QUEUE_DIR must be an absolute path");
  const environment = env.CHAT_LOG_ENVIRONMENT || (env.NODE_ENV === "production" ? "prod" : "local");
  if (!["prod", "stage", "local"].includes(environment)) throw new Error("Invalid CHAT_LOG_ENVIRONMENT");
  return { project, dataset, table, directory, credentialsFile, environment: environment as LogConfig["environment"] };
}

export function parseInsertResult(body: unknown, count: number): InsertResult {
  if (!body || typeof body !== "object" || "error" in body) throw new Error("bigquery_invalid_response");
  const errors = (body as { insertErrors?: unknown }).insertErrors;
  if (errors === undefined) return { failed: [] };
  if (!Array.isArray(errors)) throw new Error("bigquery_invalid_response");
  const failed = errors.map((error: { index?: unknown }) => {
    if (!error || !Number.isInteger(error.index) || Number(error.index) < 0 || Number(error.index) >= count) {
      throw new Error("bigquery_invalid_response");
    }
    return Number(error.index);
  });
  const reasons = [...new Set(errors.flatMap((item: { errors?: Array<{ reason?: string }> }) =>
    Array.isArray(item.errors) ? item.errors.map((error) =>
      typeof error?.reason === "string" && /^[A-Za-z]{1,64}$/.test(error.reason) ? error.reason : "unknown") : ["unknown"]))];
  return { failed: [...new Set(failed)], reasons };
}

export function bigQueryWriter(config: LogConfig): EventWriter {
  const auth = new GoogleAuth({
    keyFilename: config.credentialsFile,
    scopes: ["https://www.googleapis.com/auth/bigquery"],
    clientOptions: { transporterOptions: { timeout: 10000, retry: false } },
  });
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${config.project}/datasets/${config.dataset}/tables/${config.table}/insertAll`;
  return async (events) => {
    // ADC handles GOOGLE_APPLICATION_CREDENTIALS and token refresh. Never log raw exceptions.
    let token: string | null | undefined;
    try { token = await auth.getAccessToken(); } catch { throw new Error("bigquery_auth_failed"); }
    if (!token) throw new Error("bigquery_auth_failed");
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          skipInvalidRows: true, ignoreUnknownValues: false,
          rows: events.map((event) => ({ insertId: event.event_id, json: event })),
        }),
      });
    } catch { throw new Error("bigquery_transport_failed"); }
    if (!response.ok) throw new Error(`bigquery_http_${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error("bigquery_invalid_response"); }
    return parseInsertResult(body, events.length);
  };
}
