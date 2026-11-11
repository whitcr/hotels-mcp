import type { VisitorRole } from "./operator-role.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const telemetrySchema = z.object({
  chat_id: z.string().regex(/^[a-f0-9-]{24,36}$/i),
  language: z.enum(["uk", "ru", "en"]).optional(),
  context: z.enum(["hotel", "search"]).optional(),
  environment: z.enum(["prod", "stage", "local"]).optional(),
  message: z.string().min(1).max(4000).optional(),
  operator_token: z.string().length(32).regex(/^[a-f0-9]{32}$/i).optional(),
});

export interface ChatEvent {
  event_id: string;
  created_at: string;
  chat_id: string;
  request_id: string;
  environment: string;
  event_type: "user_message" | "assistant_message" | "error" | "integration_test";
  role: VisitorRole | "assistant" | null;
  message: string | null;
  chat_language: string | null;
  chat_context: string | null;
  response_ms: number | null;
  error_code: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

// Best-effort masking, not full anonymisation. Applied before disk/network.
export function redactMessage(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[СЕКРЕТ]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [СЕКРЕТ]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|[a-f0-9]{48,})\b/gi, "[СЕКРЕТ]")
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi, "[EMAIL]")
    .replace(/(?<!\w)\+?\d(?:[ ()-]*\d){8,18}(?!\w)/g, "[ТЕЛЕФОН АБО НОМЕР]")
    .slice(0, 16000);
}

export function makeEvent(
  context: Pick<ChatEvent, "chat_id" | "request_id" | "environment" | "chat_language" | "chat_context">,
  fields: Pick<ChatEvent, "event_type"> & Partial<Pick<ChatEvent, "role" | "message" | "response_ms" | "error_code" | "model" | "input_tokens" | "output_tokens">>,
): ChatEvent {
  return {
    ...context, event_id: randomUUID(), created_at: new Date().toISOString(),
    role: null, response_ms: null, error_code: null, model: null,
    input_tokens: null, output_tokens: null, ...fields,
    message: fields.message ? redactMessage(fields.message) : null,
  };
}
