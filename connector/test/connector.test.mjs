import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.mjs';
import { opaque, hash, challenge, loadConfig, validateAuthorization } from '../src/security.mjs';
import { database as directDatabase, USER, OTHER, APP, OTHER_APP } from './database.mjs';

const config = { publicUrl: 'https://connector.example.com', appUrl: 'https://scrollmarketer.example.com',
  resource: 'https://connector.example.com/mcp', clientId: 'scrollmarketer-chatgpt',
  redirects: ['https://chatgpt.com/test-callback'] };
const params = verifier => ({ client_id: config.clientId, redirect_uri: config.redirects[0], resource: config.resource,
  response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge(verifier),
  state: opaque(), scope: 'marketing:read drafts:write' });

import { bridgeFixture } from './bridge-fixture.mjs';

// Repeat the same OAuth/MCP/Postgres contract through the real HTTP bridge.
for (const mode of ['direct', 'bridge']) {
  const database = async () => {
    const original = await directDatabase();
    if (mode === 'direct') return original;
    const bridge = await bridgeFixture(original.store);
    const closeDatabase = original.db.close.bind(original.db);
    original.db.close = async () => { await bridge.close(); await closeDatabase(); };
    return { db: original.db, store: bridge.store };
  };
test('authorization validation rejects callback substitution, missing PKCE/resource, and unsupported scopes', () => {
  const p = params(opaque());
  assert.equal(validateAuthorization(p, config).scopes.length, 2);
  for (const bad of [{ redirect_uri: 'https://evil.example/callback' }, { resource: 'https://evil.example/mcp' },
    { code_challenge_method: 'plain' }, { scope: 'publish:write' }, { state: ['duplicate'] }]) {
    assert.throws(() => validateAuthorization({ ...p, ...bad }, config));
  }
  assert.throws(() => loadConfig({}));
});

test('real Postgres: ownership, idempotency, private credentials, and manual approval', async t => {
  const { db, store } = await database(); t.after(() => db.close());
  const args = { app_id: APP, platform: 'linkedin', content_text: 'A useful post.', idempotency_key: opaque() };
  // Idempotency keys are UUIDs at both protocol and database boundaries.
  args.idempotency_key = '00000000-0000-4000-8000-000000000005';
  const first = await store.createDraft(USER, args);
  assert.equal(first.status, 'pending'); assert.equal(first.scheduled_for, null); assert.equal(first.review_required, true);
  assert.equal((await store.createDraft(USER, args)).id, first.id);
  await assert.rejects(store.createDraft(USER, { ...args, content_text: 'Different' }));
  await assert.rejects(store.createDraft(USER, { ...args, app_id: OTHER_APP }));
  await assert.rejects(store.createDraft(USER, { ...args, platform: 'instagram' }));
  await store.createDraft(OTHER, { ...args, app_id: OTHER_APP });
  const own = await store.list('content', 'id,app_id,platform,content_text,status,scheduled_for,published_at,external_url,created_at', USER);
  assert.equal(own.records.length, 1);
  const foreign = await store.list('content', 'id,app_id,platform,content_text,status,scheduled_for,published_at,external_url,created_at', USER, { app_id: OTHER_APP });
  assert.equal(foreign.records.length, 0);
  await assert.rejects(db.query("update public.content set status='approved' where id=$1", [first.id]));
  await assert.rejects(db.query('update public.content set connector_requires_review=false where id=$1', [first.id]));
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${USER}',false);`);
  await assert.rejects(db.query('select * from public.mcp_connector_tokens'));
  await assert.rejects(db.query('select public.mcp_connector_authenticate($1)', [hash('anything')]));
  const approved = await db.query("update public.content set status='approved' where id=$1 returning id", [first.id]);
  assert.equal(approved.rows.length, 1);
  await db.exec("select set_config('request.jwt.claim.sub','',false); set role service_role;");
  // A publisher may complete a post that the owner already approved.
  await db.query("update public.content set status='published' where id=$1", [first.id]);
});

test('OAuth + MCP SDK end to end: consent, scopes, retries, rotation, replay and revocation', async t => {
  const { db, store } = await database(); t.after(() => db.close());
  const server = createApp(config, store).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetchApi = (path, options) => fetch(base + path, options);
  const appHeaders = { origin: config.appUrl, authorization: 'Bearer test-user-jwt', 'content-type': 'application/json' };
  const post = (path, body, headers = {}) => fetchApi(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const meta = await (await fetchApi('/.well-known/oauth-authorization-server')).json();
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  const denied = await post('/mcp', {}); assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate'), /resource_metadata=/);
  assert.equal((await post('/oauth/consent', { request: opaque(), approve: true })).status, 403);
  assert.equal((await post('/mcp', {}, { origin: 'https://evil.example' })).status, 403);

  async function grant(scope = 'marketing:read drafts:write') {
    const verifier = opaque(), p = { ...params(verifier), scope };
    const authorization = await fetchApi('/oauth/authorize?' + new URLSearchParams(p), { redirect: 'manual' });
    assert.equal(authorization.status, 303);
    const request = new URL(authorization.headers.get('location')).searchParams.get('request');
    const info = await fetchApi('/oauth/request/' + request, { headers: appHeaders });
    assert.equal(info.status, 200);
    const approval = await post('/oauth/consent', { request, approve: true }, appHeaders);
    assert.equal(approval.status, 200);
    const redirect = new URL((await approval.json()).redirect);
    assert.equal(redirect.searchParams.get('state'), p.state);
    assert.equal(redirect.searchParams.get('iss'), config.publicUrl);
    assert.equal((await post('/oauth/consent', { request, approve: true }, appHeaders)).status, 410);
    const body = { grant_type: 'authorization_code', code: redirect.searchParams.get('code'),
      client_id: config.clientId, redirect_uri: config.redirects[0], resource: config.resource, code_verifier: verifier };
    assert.equal((await post('/oauth/token', { ...body, code_verifier: opaque() })).status, 400);
    assert.equal((await post('/oauth/token', { ...body, resource: 'https://evil.example' })).status, 400);
    const response = await post('/oauth/token', body); assert.equal(response.status, 200);
    assert.equal((await post('/oauth/token', body)).status, 400);
    return response.json();
  }
  const tokens = await grant();
  const client = new Client({ name: 'integration-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), {
    requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 6);
  assert.ok(tools.tools.every(tool => !/publish|send|autopilot/.test(tool.name)));
  const offerings = await client.callTool({ name: 'list_offerings', arguments: {} });
  assert.equal(offerings.structuredContent.result.records.length, 1);
  for (const name of ['list_campaigns', 'list_content', 'get_post_performance', 'list_prospects']) {
    const response = await client.callTool({ name, arguments: { app_id: APP } });
    assert.equal(response.isError, undefined, name);
    assert.deepEqual(response.structuredContent.result.records, []);
  }
  const args = { app_id: APP, platform: 'linkedin', content_text: 'Created in ChatGPT.',
    idempotency_key: '00000000-0000-4000-8000-000000000009' };
  const draft = await client.callTool({ name: 'create_content_draft', arguments: args });
  assert.equal(draft.isError, undefined);
  assert.equal(draft.structuredContent.result.status, 'pending');
  assert.equal((await client.callTool({ name: 'create_content_draft', arguments: args })).structuredContent.result.id,
    draft.structuredContent.result.id);
  assert.equal((await client.callTool({ name: 'create_content_draft', arguments: { ...args, app_id: OTHER_APP } })).isError, true);
  assert.equal((await client.callTool({ name: 'list_offerings', arguments: { limit: 101 } })).isError, true);

  const readOnly = await grant('marketing:read');
  const readClient = new Client({ name: 'read-test', version: '1' }); t.after(() => readClient.close());
  await readClient.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), {
    requestInit: { headers: { authorization: `Bearer ${readOnly.access_token}` } } }));
  assert.equal((await readClient.callTool({ name: 'create_content_draft', arguments: args })).isError, true);

  const refreshBody = { grant_type: 'refresh_token', client_id: config.clientId, resource: config.resource, refresh_token: tokens.refresh_token };
  const rotated = await post('/oauth/token', refreshBody); assert.equal(rotated.status, 200);
  const newTokens = await rotated.json();
  assert.notEqual(newTokens.refresh_token, tokens.refresh_token);
  // Reusing a consumed refresh token revokes its entire family, including new access tokens.
  assert.equal((await post('/oauth/token', refreshBody)).status, 400);
  assert.equal((await post('/mcp', {}, { authorization: `Bearer ${newTokens.access_token}` })).status, 401);
  const connections = await (await fetchApi('/oauth/connections', { headers: appHeaders })).json();
  const active = connections.connections.find(c => !c.revoked_at);
  assert.ok(active);
  // A different signed-in user cannot revoke this owner's connection.
  await fetchApi('/oauth/connections/' + active.id, { method: 'DELETE', headers: { ...appHeaders, authorization: 'Bearer other-user-jwt' } });
  assert.ok(await store.authenticate(readOnly.access_token));
  assert.equal((await fetchApi('/oauth/connections/' + active.id, { method: 'DELETE', headers: appHeaders })).status, 204);
  assert.equal(await store.authenticate(readOnly.access_token), null);
  const revokeTokens = await grant();
  assert.equal((await post('/oauth/revoke', { client_id: config.clientId, token: revokeTokens.refresh_token })).status, 200);
  assert.equal(await store.authenticate(revokeTokens.access_token), null);
  assert.equal((await post('/oauth/revoke', { client_id: config.clientId, token: opaque() })).status, 200);
});

test('real Postgres: expired requests/access/grants and nullable metrics remain accurate', async t => {
  const { db, store } = await database(); t.after(() => db.close());
  const verifier = opaque(), code = opaque(), access = opaque(), refresh = opaque(), request = opaque();
  await store.createRequest(hash(request), validateAuthorization(params(verifier), config));
  await store.approve(hash(request), USER, hash(code));
  const exchange = { p_code_hash: hash(code), p_challenge: challenge(verifier), p_client_id: config.clientId,
    p_redirect_uri: config.redirects[0], p_resource: config.resource, p_access_hash: hash(access), p_refresh_hash: hash(refresh) };
  await db.query("update public.mcp_connector_requests set expires_at=now()-interval '1 minute'");
  assert.equal(await store.exchange(exchange), null);
  await db.query("update public.mcp_connector_requests set expires_at=now()+interval '1 minute'");
  const results = await Promise.all([store.exchange(exchange), store.exchange(exchange)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.ok(await store.authenticate(access));
  await db.query("update public.mcp_connector_tokens set expires_at=now()-interval '1 minute' where token_hash=$1", [hash(access)]);
  assert.equal(await store.authenticate(access), null);
  await db.query("update public.mcp_connector_grants set expires_at=now()-interval '1 minute'");
  assert.equal(await store.rotate({ p_refresh_hash: hash(refresh), p_client_id: config.clientId, p_resource: config.resource,
    p_access_hash: hash(opaque()), p_new_refresh_hash: hash(opaque()) }), null);
  await db.query("insert into public.content(user_id,app_id,platform,content_text,status) values($1,$2,'x','No measured data','published')", [USER, APP]);
  await db.query("insert into public.content(user_id,app_id,platform,content_text,status,impressions) values($1,$2,'x','Measured zero','published',0)", [USER, APP]);
  const first = await store.list('content', 'id,app_id,platform,published_at,impressions,engagements,clicks,updated_at', USER, { status: 'published', limit: 1 });
  assert.equal(first.next_offset, 1);
  const second = await store.list('content', 'id,app_id,platform,published_at,impressions,engagements,clicks,updated_at', USER, { status: 'published', limit: 1, offset: 1 });
  assert.equal(second.next_offset, null);
  assert.deepEqual([first.records[0].impressions, second.records[0].impressions].sort(), [0, null]);
  const deniedRequest = opaque();
  await store.createRequest(hash(deniedRequest), validateAuthorization(params(opaque()), config));
  assert.ok(await store.deny(hash(deniedRequest)));
  assert.equal(await store.approve(hash(deniedRequest), USER, hash(opaque())), null);
});

}
