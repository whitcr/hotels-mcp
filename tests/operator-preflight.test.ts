import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

it('operator preflight authenticates, verifies CRM identity, fails closed and makes no model calls', { timeout: 20000 }, async () => {
  const token = 'a'.repeat(32);
  let operatorId: number | null = 1324;
  let failure = false;
  let apiCalls = 0;
  const api = createServer((req, res) => {
    ++apiCalls;
    const url = new URL(req.url!, 'http://localhost');
    assert.equal(url.pathname, '/v1/info/crmtoken/operator');
    assert.equal(url.searchParams.get('token'), token);
    assert.equal(req.headers.apikey, 'fake-service-key');
    res.writeHead(failure ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: { operator_id: operatorId } }));
  });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  const apiPort = (api.address() as { port: number }).port;
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(new URL(`../src/server.${extension}`, import.meta.url))], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), MCP_AUTH_TOKEN: 'test-mcp-auth',
      HOTELS_API_URL: `http://127.0.0.1:${apiPort}/v1`, HOTELS_API_KEY: 'fake-service-key', HOTELS_API_HOST: '',
      MCP_ALLOWED_ORIGINS: 'https://allowed.example', OPENAI_API_KEY: '', CHAT_LOG_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const endpoint = `http://127.0.0.1:${port}/chat/operator`;
  const call = (body: unknown, auth = 'test-mcp-auth', origin?: string) => fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}`, ...(origin ? { origin } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(4000),
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; ++attempt) {
      if (output.includes('listening on port')) { ready = true; break; }
      if (child.exitCode !== null) throw new Error('MCP failed to start: ' + output);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(ready, output);
    assert.equal((await call({ operator_token: token }, 'wrong')).status, 401);
    assert.equal((await call({ operator_token: token }, 'test-mcp-auth', 'https://evil.example')).status, 403);
    assert.equal(apiCalls, 0);
    for (const body of [{}, { operator_token: 'forged', is_operator: true }, { role: 'operator_1324' }, { operator_token: [] }]) {
      const res = await call(body); assert.equal(res.status, 200); assert.deepEqual(await res.json(), { is_operator: false });
    }
    assert.equal(apiCalls, 0);
    let res = await call({ operator_token: token.toUpperCase() });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { is_operator: true });
    operatorId = null;
    assert.deepEqual(await (await call({ operator_token: token })).json(), { is_operator: false });
    failure = true;
    res = await call({ operator_token: token });
    assert.equal(res.status, 503); assert.equal(res.headers.get('retry-after'), '5');
    const body = await res.text(); assert(!body.includes(token)); assert(body.includes('operator_verification_unavailable'));
    assert(!output.includes(token)); assert(!output.includes('fake-service-key'));
    assert.equal(apiCalls, 3);
  } finally {
    child.kill();
    if (child.exitCode === null) await once(child, 'exit');
    api.closeAllConnections();
    await new Promise<void>(resolve => api.close(() => resolve()));
  }
});
