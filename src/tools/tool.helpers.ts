import { HotelsApiError } from "../clients/hotels-api.client.js";

export function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export async function runTool(operation: () => Promise<unknown>) {
  try {
    return toolResult(await operation());
  } catch (error) {
    const message = error instanceof HotelsApiError
      ? error.message
      : error instanceof Error ? error.message : "Unexpected tool error";
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}
