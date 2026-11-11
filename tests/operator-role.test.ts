import assert from 'node:assert/strict';
import { it } from 'node:test';
import { HotelsApiClient } from '../src/clients/hotels-api.client.js';
import { resolveVisitorRole, OperatorVerificationError } from '../src/logging/operator-role.js';
import { makeEvent, telemetrySchema } from '../src/logging/events.js';

const token = 'a'.repeat(32);

it('identifies only API-verified operator tokens and leaves ordinary visitors unchanged', async () => {
  let calls = 0;
  const validate = async (value: string) => { ++calls; assert.equal(value, token); return 123; };
  for (const value of [undefined, null, '', [], {}, 'forged', token + '\n']) {
    assert.equal(await resolveVisitorRole(value, validate), 'user');
  }
  assert.equal(calls, 0);
  assert.equal(await resolveVisitorRole(token.toUpperCase(), validate), 'operator_123');
  assert.equal(await resolveVisitorRole(token, async () => null), 'user');
  assert.equal(await resolveVisitorRole(token, async () => 'true' as any), 'user');
});

it('revalidates changed/revoked operator tokens without a stale identity cache', async () => {
  let valid: number | null = 123;
  const validate = async () => valid;
  assert.equal(await resolveVisitorRole(token, validate), 'operator_123');
  valid = null;
  assert.equal(await resolveVisitorRole(token, validate), 'user');
});

it('does not mislabel verification outages or expose the credential in errors', async () => {
  await assert.rejects(resolveVisitorRole(token, async () => { throw new Error('request failed: ' + token); }), error => {
    assert(error instanceof OperatorVerificationError);
    assert(!error.message.includes(token)); assert.equal(error.cause, undefined); return true;
  });
});

it('accepts only numeric operator IDs or explicit null from the service endpoint', async t => {
  const client = new HotelsApiClient('https://api.example.test/v1', 'test-service-key', 1000, 'api.example.test', 0);
  let payload: unknown;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: URL | RequestInfo, options?: RequestInit) => {
    ++calls;
    const target = new URL(String(url));
    assert.equal(target.pathname, '/v1/info/crmtoken/operator');
    assert.equal(target.searchParams.get('token'), token);
    assert.equal(new Headers(options?.headers).get('apikey'), 'test-service-key');
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  for (const value of [123, null]) {
    payload = { operator_id: value }; assert.equal(await client.resolveOperatorId(token), value);
    payload = { data: { operator_id: value } }; assert.equal(await client.resolveOperatorId(token), value);
  }
  for (const value of [true, false, 1, { data: 'true' }, { operator_id: '123' }, {operator_id: -1}, {operator_id: 1.5}, {operator_id: Number.MAX_SAFE_INTEGER+1}, null]) {
    payload = value; await assert.rejects(client.resolveOperatorId(token), /invalid operator identity/);
  }
  const before = calls;
  assert.equal(await client.resolveOperatorId('invalid'), null); assert.equal(calls, before);
});

it('stores the verified operator role only on the visitor event without adding a BQ column', async () => {
  const telemetry = telemetrySchema.parse({ chat_id: 'b'.repeat(32), operator_token: token, role: 'operator_forged' });
  assert(!('role' in telemetry));
  const role = await resolveVisitorRole(telemetry.operator_token, async () => 123);
  const context = { chat_id: telemetry.chat_id, request_id: 'c'.repeat(24), environment: 'local', chat_language: 'uk', chat_context: 'search' };
  const event = makeEvent(context, { event_type: 'user_message', role, message: 'Тестове повідомлення' });
  assert.equal(event.role, 'operator_123');
  assert(!('operator_token' in event));
  assert(!JSON.stringify(event).includes(token));
  assert.equal(makeEvent(context, { event_type: 'assistant_message', role: 'assistant' }).role, 'assistant');
});
