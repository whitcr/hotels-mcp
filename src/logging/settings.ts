/** Несекретні налаштування журналювання. Цей файл можна зберігати в Git. */
export const chatLogSettings = {
  // auto: записувати, якщо знайдено ключ; false: вимкнути; true: також дозволити ADC.
  enabled: "auto" as "auto" | "true" | "false",
  project: "map-hotels",
  dataset: "hotels24_chat",
  table: "events",
  credentialsFile: "secrets/bigquery.json",
  // Підтримка попереднього способу розміщення ключа поза проєктом.
  externalCredentialsFile: "/etc/hotels24-chat/bigquery.json",
  // Відносно домашнього каталогу користувача, що запускає MCP; поза Git.
  queueDirectory: ".local/state/hotels24-chat/queue",
};
