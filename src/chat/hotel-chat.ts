import OpenAI from "openai";
import type { ResponseFunctionToolCall, Tool } from "openai/resources/responses/responses";

function instructions(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the Hotels24 hotel-search assistant.
Reply in the user's language (Ukrainian, Russian, or English), warmly and concisely.
Today's date is ${today} (UTC). Check-in must be today or later and check-out must be after check-in.

Before searching, you MUST know all of these values:
1. destination city;
2. check-in and check-out dates;
3. total number of guests;
4. maximum budget in UAH;
5. whether that budget is for the entire stay or per night.

If anything is missing or ambiguous, ask one concise follow-up question that gathers all missing values. Never invent or alter dates, guest count, currency, or budget. When the user provides a day and month without a year, deterministically choose the nearest occurrence that is today or in the future. Use the current year if that calendar date has not passed; otherwise use the next year. For a date range, preserve its order and duration: resolve check-in to its nearest future occurrence, then choose the earliest check-out occurrence strictly after it (including the following year for a range crossing New Year). Tell the user the resolved full dates in the final answer. Ask for the year only if the supplied calendar date itself is invalid or genuinely cannot be determined. Never use a past check-in date. Resolve a city with resolve_destination before search_hotels. If resolution is ambiguous, ask the user to choose. Use ISO YYYY-MM-DD dates in tool calls.

When results are available, recommend at most five hotels. Render each hotel name as a Markdown link using its returned url. Add one or two factual sentences based only on returned descriptions, facilities, rating, location, matchReasons, and live prices. Never claim a preference match without supporting returned data. Mention the total or nightly price clearly and say that availability and prices should be rechecked before booking. If no result matches the confirmed budget, say so and suggest changing one constraint. When a tool reports invalid or past dates, ask for valid future dates instead of retrying. Never expose tool internals, API keys, raw JSON, or internal errors.`;
}

const tools: Tool[] = [
  {
    type: "function",
    name: "resolve_destination",
    description: "Resolve a customer-entered destination to Hotels24 IDs before searching.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 2 },
        language: { type: "string", enum: ["uk", "ru", "en"] },
      },
      required: ["query", "language"],
    },
  },
  {
    type: "function",
    name: "search_hotels",
    description: "Search live hotel availability only after all required trip and budget details are known.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        city_id: { type: "integer", minimum: 1 },
        check_in: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        check_out: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        guests: { type: "integer", minimum: 1, maximum: 30 },
        budget_max: { type: "number", exclusiveMinimum: 0 },
        budget_type: { type: "string", enum: ["total", "per_night"] },
        budget_currency: { type: "string", enum: ["UAH"] },
        stars: { type: "array", items: { type: "integer", minimum: 1, maximum: 5 } },
        exclude_hostels: { type: "boolean" },
        customer_request: { type: "string" },
        preferences: { type: "array", items: { type: "string" } },
        language: { type: "string", enum: ["uk", "ru", "en"] },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["city_id", "check_in", "check_out", "guests", "budget_max", "budget_type", "budget_currency", "language"],
    },
  },
  {
    type: "function",
    name: "get_hotel_details",
    description: "Get normalized public details for selected hotels.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        hotel_ids: { type: "array", minItems: 1, maxItems: 50, items: { type: "integer", minimum: 1 } },
        language: { type: "string", enum: ["uk", "ru", "en"] },
      },
      required: ["hotel_ids", "language"],
    },
  },
  {
    type: "function",
    name: "check_hotel_availability",
    description: "Recheck live room availability and UAH prices for one hotel.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        hotel_id: { type: "integer", minimum: 1 },
        check_in: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        check_out: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        guests: { type: "integer", minimum: 1, maximum: 30 },
      },
      required: ["hotel_id", "check_in", "check_out", "guests"],
    },
  },
];

export interface ChatResult {
  response_id: string;
  message: string;
}

export class HotelChat {
  private readonly client: OpenAI;

  constructor(apiKey: string, private readonly model: string, private readonly callTool: (name: string, args: unknown) => Promise<unknown>) {
    this.client = new OpenAI({ apiKey });
  }

  async respond(message: string, previousResponseId?: string): Promise<ChatResult> {
    let response = await this.client.responses.create({
      model: this.model,
      instructions: instructions(),
      input: message,
      previous_response_id: previousResponseId,
      tools,
      tool_choice: "auto",
    });

    for (let round = 0; round < 6; round += 1) {
      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === "function_call");
      if (!calls.length) {
        return { response_id: response.id, message: response.output_text };
      }
      const outputs = await Promise.all(calls.map(async (call) => {
        let output: unknown;
        try {
          output = await this.callTool(call.name, JSON.parse(call.arguments));
        } catch (error) {
          output = { error: error instanceof Error ? error.message : "Tool call failed" };
        }
        return { type: "function_call_output" as const, call_id: call.call_id, output: JSON.stringify(output) };
      }));
      response = await this.client.responses.create({
        model: this.model,
        instructions: instructions(),
        previous_response_id: response.id,
        input: outputs,
        tools,
        tool_choice: "auto",
      });
    }
    throw new Error("Hotel assistant exceeded the tool-call limit");
  }
}
