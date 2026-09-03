export interface Config {
  port: number;
  nodeEnv: string;
  hotelsApiUrl: string;
  hotelsApiHost?: string;
  hotelPublicBaseUrl: string;
  hotelsApiKey?: string;
  mcpAuthToken?: string;
  allowedOrigins: string[];
  requestTimeoutMs: number;
  requestRetries: number;
  maxResults: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  openAiApiKey?: string;
  openAiModel: string;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? "development";
  const config = {
    port: positiveInteger(env.PORT, 3000),
    nodeEnv,
    hotelsApiUrl: (env.HOTELS_API_URL ?? "http://api.hotels24.stage/v1").replace(/\/$/, ""),
    hotelsApiHost: env.HOTELS_API_HOST || undefined,
    hotelPublicBaseUrl: (env.HOTEL_PUBLIC_BASE_URL ?? "https://hotels24.ua").replace(/\/$/, ""),
    hotelsApiKey: env.HOTELS_API_KEY || undefined,
    mcpAuthToken: env.MCP_AUTH_TOKEN || undefined,
    allowedOrigins: (env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    requestTimeoutMs: positiveInteger(env.HOTELS_API_TIMEOUT_MS, 8_000),
    requestRetries: Math.min(positiveInteger(env.HOTELS_API_RETRIES, 2), 5),
    maxResults: Math.min(positiveInteger(env.MCP_MAX_RESULTS, 20), 50),
    rateLimitWindowMs: positiveInteger(env.MCP_RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMaxRequests: positiveInteger(env.MCP_RATE_LIMIT_MAX_REQUESTS, 120),
    openAiApiKey: env.OPENAI_API_KEY || undefined,
    openAiModel: env.OPENAI_MODEL || "gpt-5-mini",
  };

  const urlsToValidate: Array<[string, string]> = [
    ["HOTELS_API_URL", config.hotelsApiUrl],
    ["HOTEL_PUBLIC_BASE_URL", config.hotelPublicBaseUrl],
  ];
  for (const [name, value] of urlsToValidate) {
    const url = new URL(value);
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
      throw new Error(`${name} must use http or https`);
    }
  }
  if (nodeEnv === "production" && !config.mcpAuthToken) {
    throw new Error("MCP_AUTH_TOKEN is required in production");
  }
  return config;
}
