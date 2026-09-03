# Hotels24 MCP server

Production-oriented, read-only MCP adapter over the legacy Hotels24 API. It exposes four tools:

- `resolve_destination`
- `search_hotels`
- `get_hotel_details`
- `check_hotel_availability`

The service never invents hotel data. It can be used directly as an MCP server through `/mcp`, or as a ready-made OpenAI Responses API assistant through `/chat`. `search_hotels` returns compact factual data, absolute hotel links, relevance evidence, and response guidance for a customer-facing answer.

## Required search information

The model must collect and confirm all of these values before calling `search_hotels`:

1. city;
2. check-in and check-out dates;
3. total number of guests;
4. maximum budget;
5. whether the budget is for the entire stay or per night;
6. budget in UAH.

These values are required by the MCP input schema. There are deliberately no defaults for guests or budget. If something is missing or ambiguous, the assistant must ask a concise clarification question and must not guess.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOTELS_API_URL` | `http://api.hotels24.stage/v1` | Legacy API base URL; set it to the production API URL in `.env`. |
| `HOTELS_API_HOST` | empty | Optional Host override for non-Compose deployments. |
| `OPENAI_API_KEY` | empty | OpenAI API key required only for the `/chat` endpoint. |
| `OPENAI_MODEL` | `gpt-5-mini` | Responses API model used by the hotel assistant. |
| `HOTEL_PUBLIC_BASE_URL` | `https://hotels24.ua` | Origin used to build safe absolute hotel links |
| `HOTELS_API_KEY` | empty | Value sent in the legacy `apiKey` HTTP header |
| `HOTELS_API_TIMEOUT_MS` | `8000` | Upstream timeout |
| `HOTELS_API_RETRIES` | `2` | Retries for timeouts, 429, 502, 503, and 504 |
| `MCP_AUTH_TOKEN` | empty | Optional bearer token protecting `/mcp` |
| `MCP_ALLOWED_ORIGINS` | empty | Optional comma-separated HTTP Origin allowlist |
| `MCP_MAX_RESULTS` | `20` | Hard result cap, maximum 50 |
| `MCP_RATE_LIMIT_WINDOW_MS` | `60000` | In-memory rate-limit window |
| `MCP_RATE_LIMIT_MAX_REQUESTS` | `120` | Requests per IP and window |

`MCP_AUTH_TOKEN` is mandatory when `NODE_ENV=production`. Do not expose `HOTELS_API_KEY` or `OPENAI_API_KEY` to a browser. Terminate TLS at a reverse proxy or load balancer and expose only the endpoints your application needs.

## Local development

Node.js 20 or newer is required; the Docker image uses Node.js 22.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

Health check:

```bash
curl http://localhost:3001/health
```

## OpenAI Responses API

Configure the remote MCP tool with a public HTTPS URL (or OpenAI Secure MCP Tunnel for a private service) and the access token. Because every current tool is read-only, approval can be disabled after validating the integration. If booking or payment tools are ever added, require approval for those tools.

```js
const response = await openai.responses.create({
  model: "gpt-5.6-luna",
  input: "Знайди готель у Львові на 10–12 вересня для двох",
  tools: [{
    type: "mcp",
    server_label: "hotels24",
    server_description: "Search live Hotels24 hotel availability and return factual recommendations with direct hotel links.",
    server_url: "https://example.com/mcp",
    authorization: process.env.MCP_AUTH_TOKEN,
    require_approval: "never"
  }]
});
```

Recommended application instruction:

```text
You are a hotel search assistant. Before searching, collect and confirm:
- city;
- check-in and check-out dates;
- total guest count;
- maximum budget in UAH;
- whether that budget is total or per night.

If any required value is missing or ambiguous, ask one concise clarification
question covering the missing values. Do not call search_hotels and do not infer
defaults. If the city resolver returns multiple plausible cities, ask the user
to choose one.

For current availability or prices, always use the Hotels24 MCP tools. Resolve
the destination first, then call search_hotels with the original
customer_request and explicit preferences.

Answer in the customer's language. Show 3–5 options. For every option:
1. render the hotel name as a Markdown link using the returned url;
2. give one or two short factual sentences tailored to the request;
3. show total live price, currency, dates, and rating when present;
4. mention only match reasons and facilities returned by the tool.

Never invent amenities, distance, rating, price, or availability. Say when data
is missing. End with a short note that price and availability should be rechecked
before booking.
```

Example customer-facing shape:

```markdown
### [Назва готелю](https://hotels24.ua/...)

Короткий опис готелю та чому він відповідає запиту. Підтверджені зручності:
Wi-Fi, сніданок. Вартість за вибрані дати: 4 200 UAH.
```

Prices returned by the current legacy availability endpoint are in UAH. The MCP server intentionally performs no implicit currency conversion. Hotel descriptions are stripped of HTML, links are constrained to `HOTEL_PUBLIC_BASE_URL`, and only compact public fields are returned to the model.

## GPT hotel assistant

`POST /chat` provides a multi-turn customer conversation on top of the MCP tools. It asks for the city, check-in/check-out dates, guest count, and maximum UAH budget before searching.

Start a conversation:

```bash
curl -sS http://127.0.0.1:3001/chat \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"message":"Хочу готель у Львові"}'
```

Send `previous_response_id` from that response with the next customer message:

```bash
curl -sS http://127.0.0.1:3001/chat \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"message":"15–17 вересня, двоє гостей, до 6000 грн за весь період","previous_response_id":"resp_..."}'
```
# hotels-mcp
