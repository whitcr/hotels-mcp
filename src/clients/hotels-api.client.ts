type QueryValue = string | number | boolean | null | undefined | Array<string | number>;

export class HotelsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = "HotelsApiError";
  }
}

export class HotelsApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly timeoutMs = 8_000,
    private readonly hostHeader?: string,
    private readonly retries = 2,
    /** Enables a short in-memory cache for repeated identical lookups (e.g. "show more options"). */
    private readonly cacheEnabled = false,
  ) {}

  private readonly cache = new Map<string, { expires: number; value: Promise<unknown> }>();

  private cached(key: string, ttlMs: number, load: () => Promise<unknown>): Promise<unknown> {
    if (!this.cacheEnabled || ttlMs <= 0) return load();
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expires > now) return hit.value;
    const value = load();
    this.cache.set(key, { expires: now + ttlMs, value });
    // A failed lookup must never be served again.
    value.catch(() => { if (this.cache.get(key)?.value === value) this.cache.delete(key); });
    if (this.cache.size > 300) {
      for (const [entry, record] of this.cache) if (record.expires <= now) this.cache.delete(entry);
      while (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
    }
    return value;
  }

  async resolveOperatorId(token: string): Promise<number | null> {
    if (token.length !== 32 || !/^[a-f0-9]{32}$/.test(token)) return null;
    const payload = await this.get("/info/crmtoken/operator", 0, { token });
    const identity = payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
    if (!identity || typeof identity !== "object" || !("operator_id" in identity)) {
      throw new HotelsApiError("Hotels API returned invalid operator identity");
    }
    const id = identity.operator_id;
    if (id === null) return null;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      throw new HotelsApiError("Hotels API returned invalid operator identity");
    }
    return id;
  }

  resolveDestination(query: string, language: string): Promise<unknown> {
    return this.get("/search/hotel-city-region", 300_000, { s: query, lang: language });
  }

  getAvailability(params: {
    hotelIds?: number[];
    cityIds?: number[];
    regionIds?: number[];
    checkIn: string;
    checkOut: string;
    guests: number;
    stars?: number[];
    hotelTypes?: number[];
    excludeHostels?: boolean;
    /** Skip the cache: a customer-facing re-check must be live. */
    fresh?: boolean;
  }): Promise<unknown> {
    // `/availability/blocks` is an obsolete production route and currently
    // fails with MongoDB `bad sort specification`. This is the established
    // public legacy availability route used for live hotel/room data.
    return this.get("/legacy/getBlockAvailability", params.fresh ? 0 : 60_000, {
      hotel_ids: params.hotelIds,
      city_ids: params.cityIds,
      Region_ids: params.regionIds,
      arrival_date: params.checkIn,
      departure_date: params.checkOut,
      max_persons: params.guests,
      stars: params.stars,
      hoteltype_id: params.hotelTypes,
      exclude_hostel: params.excludeHostels ? 1 : undefined,
    });
  }

  getHotelDetails(hotelIds: number[], language: string): Promise<unknown> {
    return this.get("/hotel/hotel-info", 600_000, {
      hotel_ids: hotelIds,
      lang: language,
      limit: Math.min(hotelIds.length, 50),
    });
  }

  private get(path: string, ttlMs: number, query: Record<string, QueryValue>): Promise<unknown> {
    const url = this.buildUrl(path, query);
    return this.cached(url.href, ttlMs, () => this.fetchJson(url));
  }

  private buildUrl(path: string, query: Record<string, QueryValue>): URL {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(`${key}[]`, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private async fetchJson(url: URL): Promise<unknown> {
    let lastError: HotelsApiError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url, {
          headers: {
            accept: "application/json",
            // The legacy firewall reads the `apiKey` request header. HTTP
            // headers are case-insensitive, so `apikey` is the wire-safe form.
            ...(this.apiKey ? { apikey: this.apiKey } : {}),
            ...(this.hostHeader ? { host: this.hostHeader } : {}),
          },
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const error = new HotelsApiError(
            `Hotels API returned HTTP ${response.status}`,
            response.status,
            text.slice(0, 1_000),
          );
          if (![429, 502, 503, 504].includes(response.status) || attempt === this.retries) throw error;
          lastError = error;
        } else {
          try {
            return JSON.parse(text) as unknown;
          } catch {
            throw new HotelsApiError("Hotels API returned invalid JSON", response.status, text.slice(0, 1_000));
          }
        }
      } catch (error) {
        const normalized = error instanceof HotelsApiError
          ? error
          : error instanceof Error && error.name === "AbortError"
            ? new HotelsApiError(`Hotels API timed out after ${this.timeoutMs}ms`)
            : new HotelsApiError(error instanceof Error ? error.message : "Hotels API request failed");
        if (attempt === this.retries || (normalized.status !== undefined && ![429, 502, 503, 504].includes(normalized.status))) {
          throw normalized;
        }
        lastError = normalized;
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * (2 ** attempt) + Math.floor(Math.random() * 100)));
    }
    throw lastError ?? new HotelsApiError("Hotels API request failed");
  }
}
