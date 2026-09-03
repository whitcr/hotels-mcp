import { randomUUID, timingSafeEqual } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";

import { HotelChat } from "./chat/hotel-chat.js";
import { HotelsApiClient } from "./clients/hotels-api.client.js";
import { loadConfig } from "./config.js";
import { registerHotelTools } from "./tools/index.js";

const config = loadConfig();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

app.use((request, response, next) => {
  const requestId = request.header("x-request-id")?.slice(0, 128) || randomUUID();
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

function createServer(): McpServer {
  const server = new McpServer({ name: "hotels24", version: "0.1.0" });
  registerHotelTools(server, {
    client: new HotelsApiClient(
      config.hotelsApiUrl,
      config.hotelsApiKey,
      config.requestTimeoutMs,
      config.hotelsApiHost,
      config.requestRetries,
    ),
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

const hotelChat = config.openAiApiKey
  ? new HotelChat(config.openAiApiKey, config.openAiModel, callLocalTool)
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

app.post("/chat", requireAllowedOrigin, rateLimit, requireAuth, async (request, response, next) => {
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
  try {
    response.json(await hotelChat.respond(message, previousResponseId));
  } catch (error) {
    next(error);
  }
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

const httpServer = app.listen(config.port, "0.0.0.0", () => {
  console.log(`hotels24-mcp listening on port ${config.port}`);
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  httpServer.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
