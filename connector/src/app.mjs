import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { SCOPES, opaque, hash, challenge, parseScopes, validateAuthorization, authorizationRedirect } from './security.mjs';
import { createMcpServer } from './tools.mjs';

export function createApp(config, store) {
  const app = express();
  app.disable('x-powered-by');
  const origins = [config.appUrl, 'https://chatgpt.com', 'https://chat.openai.com'];
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    const origin = req.get('origin');
    if (origin && !origins.includes(origin)) return res.status(403).json({ error: 'origin_not_allowed' });
    if (origin) res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'WWW-Authenticate' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '8kb' }));
  // Do not blindly trust forwarding headers; no proxy trust is configured by default.
  app.use('/oauth', rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.get('/health', (_req, res) => res.json({ service: 'scrollmarketer-connector', version: '0.1.0' }));
  app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => res.json({
    resource: config.resource, authorization_servers: [config.publicUrl], scopes_supported: SCOPES,
    bearer_methods_supported: ['header'], resource_name: 'Scroll Marketer' }));
  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
    issuer: config.publicUrl, authorization_endpoint: `${config.publicUrl}/oauth/authorize`,
    token_endpoint: `${config.publicUrl}/oauth/token`, revocation_endpoint: `${config.publicUrl}/oauth/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
    scopes_supported: SCOPES, authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false }));

  app.get('/oauth/authorize', async (req, res) => {
    let params;
    try { params = validateAuthorization(req.query, config); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const request = opaque();
    await store.createRequest(hash(request), params);
    const url = new URL('/chatgpt-connect', config.appUrl);
    url.searchParams.set('request', request);
    res.redirect(303, url.toString());
  });

  async function requireAppUser(req, res, next) {
    // Consent uses an existing Scroll Marketer login; cookies alone never grant access.
    if (req.get('origin') !== config.appUrl) return res.status(403).json({ error: 'origin_not_allowed' });
    const bearer = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
    if (!bearer) return res.status(401).json({ error: 'login_required' });
    req.userId = await store.user(bearer[1]);
    if (!req.userId) return res.status(401).json({ error: 'login_required' });
    next();
  }
  const requestId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
  app.get('/oauth/request/:request', requireAppUser, async (req, res) => {
    const parsed = requestId.safeParse(req.params.request);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' });
    const row = await store.request(hash(parsed.data));
    if (!row) return res.status(410).json({ error: 'request_expired' });
    res.json({ client_id: row.client_id, scopes: row.scopes, expires_at: row.expires_at });
  });
  app.post('/oauth/consent', requireAppUser, async (req, res) => {
    const parsed = z.object({ request: requestId, approve: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' });
    const code = opaque();
    const row = parsed.data.approve
      ? await store.approve(hash(parsed.data.request), req.userId, hash(code))
      : await store.deny(hash(parsed.data.request));
    if (!row) return res.status(410).json({ error: 'request_expired' });
    res.json({ redirect: authorizationRedirect(row, config,
      parsed.data.approve ? { code } : { error: 'access_denied' }) });
  });
  app.get('/oauth/connections', requireAppUser, async (req, res) => res.json({ connections: await store.connections(req.userId) }));
  app.delete('/oauth/connections/:id', requireAppUser, async (req, res) => {
    const parsed = z.string().uuid().safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' });
    await store.revoke(req.userId, parsed.data);
    res.sendStatus(204);
  });
  app.post('/oauth/token', async (req, res) => {
    const body = req.body || {};
    if (body.client_id !== config.clientId) return res.status(400).json({ error: 'invalid_client' });
    if (body.resource !== config.resource && !(body.grant_type === 'refresh_token' && body.resource === undefined)) {
      return res.status(400).json({ error: 'invalid_target' });
    }
    const access = opaque(), refresh = opaque();
    let grant;
    if (body.grant_type === 'authorization_code') {
      if (!requestId.safeParse(body.code).success || typeof body.code_verifier !== 'string' ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier) || !config.redirects.includes(body.redirect_uri)) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      grant = await store.exchange({ p_code_hash: hash(body.code), p_challenge: challenge(body.code_verifier),
        p_client_id: config.clientId, p_redirect_uri: body.redirect_uri, p_resource: config.resource,
        p_access_hash: hash(access), p_refresh_hash: hash(refresh) });
    } else if (body.grant_type === 'refresh_token') {
      if (!requestId.safeParse(body.refresh_token).success) return res.status(400).json({ error: 'invalid_grant' });
      // An omitted resource retains the original audience. A supplied scope must match the grant.
      let scopes = null;
      try { if (body.scope !== undefined) scopes = parseScopes(body.scope); }
      catch { return res.status(400).json({ error: 'invalid_scope' }); }
      grant = await store.rotate({ p_refresh_hash: hash(body.refresh_token), p_client_id: config.clientId,
        p_resource: config.resource, p_access_hash: hash(access), p_new_refresh_hash: hash(refresh), p_scopes: scopes });
    } else return res.status(400).json({ error: 'unsupported_grant_type' });
    if (!grant) return res.status(400).json({ error: 'invalid_grant' });
    res.json({ access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: grant.scopes.join(' ') });
  });
  app.post('/oauth/revoke', async (req, res) => {
    if (req.body?.client_id !== config.clientId) return res.status(400).json({ error: 'invalid_client' });
    if (typeof req.body.token === 'string' && req.body.token.length < 256) await store.revokeToken(req.body.token, config.clientId);
    res.sendStatus(200);
  });
  function unauthorized(res) {
    return res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource/mcp"`).json({ error: 'invalid_token' });
  }
  app.use('/mcp', async (req, res, next) => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '')?.[1];
    if (!token) return unauthorized(res);
    const auth = await store.authenticate(token);
    if (!auth || auth.client_id !== config.clientId || auth.resource !== config.resource) return unauthorized(res);
    req.connectorAuth = { ...auth, token };
    next();
  }, rateLimit({ windowMs: 60000, limit: 120, keyGenerator: req => req.connectorAuth.user_id,
    standardHeaders: 'draft-8', legacyHeaders: false }));
  app.post('/mcp', async (req, res) => {
    const server = createMcpServer(store, req.connectorAuth);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed' }));
  app.use((error, _req, res, _next) => {
    // Never log request URLs, codes, tokens, JWTs, or DB error contents.
    if (res.headersSent) return res.end();
    const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 503;
    res.status(status).json({ error: status === 503 ? 'temporarily_unavailable' : 'invalid_request' });
  });
  return app;
}
