export interface ChatUsage {
  input_tokens: number | null;
  output_tokens: number | null;
}

/** Count fresh model responses in one HTTP turn, never retrieved history. */
export class UsageAccumulator {
  private count = 0;
  private totals: ChatUsage = { input_tokens: 0, output_tokens: 0 };

  add(usage: { input_tokens?: number; output_tokens?: number } | null | undefined): void {
    this.count++;
    for (const field of ["input_tokens", "output_tokens"] as const) {
      const value = usage?.[field];
      const total = this.totals[field];
      // Missing/invalid usage is unknown, not zero or an apparently complete sum.
      this.totals[field] = total !== null && typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && Number.isSafeInteger(total + value)
        ? total + value : null;
    }
  }

  snapshot(): ChatUsage {
    return this.count ? { ...this.totals } : { input_tokens: null, output_tokens: null };
  }
}

/** Preserve reported usage even when a later API call or validation fails. */
export class ChatGenerationError extends Error {
  constructor(cause: unknown, readonly usage: ChatUsage) {
    super(cause instanceof Error ? cause.message : "Hotel assistant failed", { cause });
    this.name = "ChatGenerationError";
  }
}
