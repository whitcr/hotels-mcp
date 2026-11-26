import { resolveVisitorRole, type VisitorRole } from "./logging/operator-role.js";
import { ChatGenerationError } from "./chat/usage.js";
import { randomUUID, timingSafeEqual } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";

import { HotelChat } from "./chat/hotel-chat.js";
import { HotelsApiClient } from "./clients/hotels-api.client.js";
import { loadConfig } from "./config.js";
import { registerHotelTools } from "./tools/index.js";
import { bigQueryWriter, logConfig } from "./logging/bigquery.js";
import { makeEvent, telemetrySchema, uiEventSchema } from "./logging/events.js";
import { ChatLogQueue } from "./logging/queue.js";

const config = loadConfig();
const logging = logConfig();
const chatLogs = logging ? new ChatLogQueue(logging.directory, bigQueryWriter(logging)) : undefined;
console.log(JSON.stringify({ level: "info", event: "chat_logging", enabled: Boolean(chatLogs) }));
chatLogs?.start();
const app = express();
app.disable("x-powered-by");
// The service sits behind one reverse proxy (nginx); take the client IP from it.
app.set("trust proxy", 1);
// Proves a request came from this process (HotelChat -> local /mcp), so internal
// tool calls do not drain the per-client rate limit of real visitors.
const internalCallKey = randomUUID();
app.use(express.json({ limit: "1mb" }));

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

app.use((request, response, next) => {
  const suppliedRequestId = request.header("x-request-id");
  const requestId = suppliedRequestId && /^[a-zA-Z0-9_-]{12,128}$/.test(suppliedRequestId) ? suppliedRequestId : randomUUID();
  const startedAt = Date.now();
  response.locals.requestId = requestId;
  response.set({
    "X-Request-Id": requestId,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  });
  response.on("finish", () => {
    console.log(JSON.stringify({
      level: "info",
      event: "http_request",
      request_id: requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      duration_ms: Date.now() - startedAt,
    }));
  });
  next();
});

function requireAllowedOrigin(request: Request, response: Response, next: NextFunction): void {
  const origin = request.header("origin");
  if (!origin || !config.allowedOrigins.length || config.allowedOrigins.includes(origin)) return next();
  response.status(403).json({ error: "Origin is not allowed", request_id: response.locals.requestId });
}

function rateLimit(request: Request, response: Response, next: NextFunction): void {
  const internal = Buffer.from(request.header("x-internal-call") ?? "");
  const expectedKey = Buffer.from(internalCallKey);
  if (internal.length === expectedKey.length && timingSafeEqual(internal, expectedKey)) return next();
  const now = Date.now();
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const current = rateBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + config.rateLimitWindowMs }
    : current;
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  response.set({
    "RateLimit-Limit": String(config.rateLimitMaxRequests),
    "RateLimit-Remaining": String(Math.max(0, config.rateLimitMaxRequests - bucket.count)),
    "RateLimit-Reset": String(Math.ceil(bucket.resetAt / 1000)),
  });
  if (rateBuckets.size > 10_000) {
    for (const [bucketKey, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(bucketKey);
  }
  if (bucket.count <= config.rateLimitMaxRequests) return next();
  response.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
  response.status(429).json({ error: "Too many requests", request_id: response.locals.requestId });
}

function authorized(request: Request): boolean {
  if (!config.mcpAuthToken) return true;
  const expected = Buffer.from(`Bearer ${config.mcpAuthToken}`);
  const actual = Buffer.from(request.header("authorization") ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (authorized(request)) return next();
  response.status(401).set("WWW-Authenticate", "Bearer").json({ error: "Unauthorized" });
}

// One shared client: its short-lived cache must survive across stateless /mcp requests.
const hotelsApi = new HotelsApiClient(
  config.hotelsApiUrl,
  config.hotelsApiKey,
  config.requestTimeoutMs,
  config.hotelsApiHost,
  config.requestRetries,
  true,
);

function createServer(): McpServer {
  const server = new McpServer({ name: "hotels24", version: "0.1.0" });
  registerHotelTools(server, {
    client: hotelsApi,
    maxResults: config.maxResults,
    hotelPublicBaseUrl: config.hotelPublicBaseUrl,
  });
  return server;
}

async function callLocalTool(name: string, args: unknown): Promise<unknown> {
  const rpcResponse = await fetch(`http://127.0.0.1:${config.port}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.mcpAuthToken ?? ""}`,
      "content-type": "application/json",
      "x-internal-call": internalCallKey,
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = await rpcResponse.text();
  if (!rpcResponse.ok) throw new Error(`MCP tool transport returned HTTP ${rpcResponse.status}`);
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error("MCP tool returned an invalid response");
  const message = JSON.parse(dataLine.slice(6)) as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown };
  };
  if (message.error) throw new Error(message.error.message || "MCP tool failed");
  if (message.result?.isError) throw new Error(message.result.content?.[0]?.text || "MCP tool failed");
  return message.result?.structuredContent ?? message.result?.content;
}

// Operator identification uses existing service authentication, with a bounded
// extra request. It is not exposed as a model tool and is never sent to OpenAI.
const operatorApi = new HotelsApiClient(config.hotelsApiUrl, config.hotelsApiKey,
  Math.min(config.requestTimeoutMs, 3000), config.hotelsApiHost, 0);

const hotelChat = config.openAiApiKey
  ? new HotelChat(config.openAiApiKey, config.openAiModel, callLocalTool, { reasoningEffort: config.openAiReasoningEffort })
  : undefined;

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "hotels24-mcp", version: "0.1.0" });
});

app.get("/ready", (_request, response) => {
  response.json({
    status: "ready",
    upstream_configured: Boolean(config.hotelsApiUrl),
    chat_configured: Boolean(hotelChat),
    chat_model: config.openAiModel,
  });
});

// Server-to-server preflight for PHP session quota exemptions. No model/BQ calls.
app.post("/chat/operator", requireAllowedOrigin, rateLimit, requireAuth, async (request, response) => {
  try {
    const role = await resolveVisitorRole(request.body?.operator_token, token => operatorApi.resolveOperatorId(token));
    response.json({ is_operator: role !== "user" });
  } catch {
    response.status(503).set("Retry-After", "5").json({ error: "operator_verification_unavailable", request_id: response.locals.requestId });
  }
});

// One implementation for both transports: plain JSON (/chat) and Server-Sent Events (/chat/stream).
const chatRoute = (streaming: boolean) => async (request: Request, response: Response, next: NextFunction) => {
  if (!hotelChat) {
    response.status(503).json({ error: "OPENAI_API_KEY is not configured", request_id: response.locals.requestId });
    return;
  }
  const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";
  const previousResponseId = typeof request.body?.previous_response_id === "string"
    ? request.body.previous_response_id.trim()
    : undefined;
  if (!message || message.length > 4_000) {
    response.status(400).json({ error: "message must contain 1-4000 characters", request_id: response.locals.requestId });
    return;
  }
  if (previousResponseId && !/^resp_[A-Za-z0-9_-]{8,200}$/.test(previousResponseId)) {
    response.status(400).json({ error: "previous_response_id is invalid", request_id: response.locals.requestId });
    return;
  }
  const parsedTelemetry = telemetrySchema.safeParse(request.body?.telemetry);
  const telemetry = parsedTelemetry.success ? parsedTelemetry.data : undefined;
  let visitorRole: VisitorRole;
  try {
    visitorRole = await resolveVisitorRole(telemetry?.operator_token, token => operatorApi.resolveOperatorId(token));
  } catch {
    console.warn(JSON.stringify({ event: "operator_verification_failed", request_id: response.locals.requestId }));
    response.status(503).set("Retry-After", "5").json({ error: "operator_verification_unavailable", request_id: response.locals.requestId });
    return;
  }
  const chatId = telemetry?.chat_id || randomUUID();
  const context = {
    chat_id: chatId, request_id: response.locals.requestId as string,
    environment: telemetry?.environment || logging?.environment || "local",
    chat_language: telemetry?.language || null, chat_context: telemetry?.context || null,
  };
  const startedAt = Date.now();
  await chatLogs?.enqueue(makeEvent(context, { event_type: "user_message", role: visitorRole, message: telemetry?.message || message }));
  let send: (event: string, data: unknown) => void = () => undefined;
  let keepAlive: NodeJS.Timeout | undefined;
  if (streaming) {
    response.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", Connection: "keep-alive",
    });
    response.flushHeaders();
    send = (event, data) => { if (!response.writableEnded) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    keepAlive = setInterval(() => { if (!response.writableEnded) response.write(": ping\n\n"); }, 10_000);
    response.on("close", () => clearInterval(keepAlive));
  }
  try {
    const { usage, analytics, timing, ...result } = await hotelChat.respond(message, previousResponseId, telemetry?.language,
      streaming ? { onDelta: text => send("delta", { text }), onStatus: phase => send("status", { phase }) } : undefined,
      { cards: telemetry?.cards === true, call: telemetry?.call === true, page: telemetry?.page });
    // Where the time goes: model rounds and tool calls (no message text).
    console.log(JSON.stringify({ event: "chat_timing", request_id: response.locals.requestId, total_ms: Date.now() - startedAt, ...timing }));
    for (const item of analytics) {
      await chatLogs?.enqueue(makeEvent({ ...context, chat_language: result.language }, {
        event_type: item.kind, role: "assistant", message: JSON.stringify(item.detail),
      }));
    }
    await chatLogs?.enqueue(makeEvent({...context, chat_language:result.language}, {
      event_type: "assistant_message", role: "assistant", message: result.message,
      response_ms: Date.now() - startedAt, model: config.openAiModel, ...usage,
    }));
    if (streaming) {
      clearInterval(keepAlive);
      send("done", { ...result, chat_id: chatId });
      response.end();
    } else {
      response.json({ ...result, chat_id: chatId });
    }
  } catch (error) {
    await chatLogs?.enqueue(makeEvent(context, {
      event_type: "error", error_code: "chat_generation_failed", response_ms: Date.now() - startedAt,
      ...(error instanceof ChatGenerationError ? error.usage : {}),
      model: config.openAiModel,
    }));
    if (streaming) {
      // Headers are already sent: report the failure as an event instead of an HTTP status.
      clearInterval(keepAlive);
      send("error", { error: "chat_generation_failed", request_id: response.locals.requestId });
      response.end();
    } else {
      next(error);
    }
  }
};

app.post("/chat", requireAllowedOrigin, rateLimit, requireAuth, chatRoute(false));
app.post("/chat/stream", requireAllowedOrigin, rateLimit, requireAuth, chatRoute(true));

// Funnel events from the chat widget (clicks). Server-to-server, like /chat; no personal data accepted.
app.post("/chat/event", requireAllowedOrigin, rateLimit, requireAuth, async (request, response) => {
  const parsed = uiEventSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_event", request_id: response.locals.requestId });
    return;
  }
  const { chat_id, type, hotel_id, environment } = parsed.data;
  await chatLogs?.enqueue(makeEvent({
    chat_id, request_id: response.locals.requestId as string, environment: environment || logging?.environment || "local",
    chat_language: null, chat_context: null,
  }, { event_type: "ui_click", message: JSON.stringify({ type, ...(hotel_id ? { hotel_id } : {}) }) }));
  response.status(202).json({ accepted: true });
});

app.post("/mcp", requireAllowedOrigin, rateLimit, requireAuth, async (request, response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, request.body);
});

app.get("/mcp", requireAllowedOrigin, rateLimit, requireAuth, (_request, response) => {
  response.status(405).set("Allow", "POST").json({ error: "Stateless MCP endpoint accepts POST only" });
});

app.delete("/mcp", requireAllowedOrigin, rateLimit, requireAuth, (_request, response) => {
  response.status(405).set("Allow", "POST").json({ error: "Stateless MCP endpoint has no sessions" });
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(JSON.stringify({
    level: "error",
    event: "unhandled_error",
    request_id: response.locals.requestId,
    message: error instanceof Error ? error.message : "Unknown error",
  }));
  if (!response.headersSent) {
    response.status(500).json({ error: "Internal server error", request_id: response.locals.requestId });
  }
});

const httpServer = app.listen(config.port, "127.0.0.1", () => {
  console.log(`hotels24-mcp listening on port ${config.port}`);
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  httpServer.close(async (error) => {
    await chatLogs?.close();
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
