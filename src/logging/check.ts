import { randomUUID } from "node:crypto";
import { bigQueryWriter, logConfig } from "./bigquery.js";
import { makeEvent } from "./events.js";

// Explicit operator command: writes one synthetic event, never calls OpenAI or Hotels API.
try {
  const config = logConfig();
  if (!config) throw new Error("Журналювання вимкнено або ключ secrets/bigquery.json відсутній");
  const event = makeEvent({
    chat_id: randomUUID(), request_id: randomUUID(), environment: "local",
    chat_language: "uk", chat_context: "search",
  }, { event_type: "integration_test", message: "Тест підключення журналу ШІ-чату Hotels24. Даних користувачів немає." });
  const result = await bigQueryWriter(config)([event]);
  if (result.failed.length) {
    console.error(JSON.stringify({ status: "error", code: "bigquery_row_rejected", reasons: result.reasons }));
    process.exitCode = 1;
  } else console.log(JSON.stringify({ status: "ok", event_id: event.event_id, table: `${config.project}.${config.dataset}.${config.table}` }));
} catch (error) {
  // Only our fixed error strings, never the credential/library exception object.
  console.error(JSON.stringify({ status: "error", code: error instanceof Error ? error.message : "check_failed" }));
  process.exitCode = 1;
}
