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
  ) {}

  resolveDestination(query: string, language: string): Promise<unknown> {
    return this.get("/search/hotel-city-region", { s: query, lang: language });
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
  }): Promise<unknown> {
    // `/availability/blocks` is an obsolete production route and currently
    // fails with MongoDB `bad sort specification`. This is the established
    // public legacy availability route used for live hotel/room data.
    return this.get("/legacy/getBlockAvailability", {
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
    return this.get("/hotel/hotel-info", {
      hotel_ids: hotelIds,
      lang: language,
      limit: Math.min(hotelIds.length, 50),
    });
  }

  private async get(path: string, query: Record<string, QueryValue>): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(`${key}[]`, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

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
