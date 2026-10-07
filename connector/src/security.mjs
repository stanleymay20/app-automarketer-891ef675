import { createHash, randomBytes } from 'node:crypto';

export const SCOPES = ['marketing:read', 'drafts:write'];
export const opaque = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const challenge = value => createHash('sha256').update(value).digest('base64url');

export function parseScopes(value = 'marketing:read') {
  if (typeof value !== 'string') throw new Error('invalid_scope');
  const scopes = [...new Set(value.split(' ').filter(Boolean))];
  if (!scopes.length || scopes.some(s => !SCOPES.includes(s))) throw new Error('invalid_scope');
  return scopes;
}

export function loadConfig(env) {
  const required = ['CONNECTOR_PUBLIC_URL', 'SCROLLMARKETER_APP_URL', 'CONNECTOR_CLIENT_ID',
    'CONNECTOR_REDIRECT_URIS', 'SUPABASE_URL'];
  for (const key of required) if (!env[key]) throw new Error(`Missing ${key}`);
  const publicUrl = new URL(env.CONNECTOR_PUBLIC_URL);
  const appUrl = new URL(env.SCROLLMARKETER_APP_URL);
  const local = env.NODE_ENV === 'test' || env.NODE_ENV === 'development';
  const backend = new URL(env.SUPABASE_URL);
  if (backend.protocol !== 'https:' || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/') {
    throw new Error('Invalid backend origin');
  }
  let bridge;
  if (env.CONNECTOR_BRIDGE_URL || env.CONNECTOR_BRIDGE_SECRET) {
    if (!env.SUPABASE_PUBLISHABLE_KEY || !/^[A-Za-z0-9_-]{43,128}$/.test(env.CONNECTOR_BRIDGE_SECRET || '')) {
      throw new Error('Bridge requires public key and a random 32-byte or longer secret');
    }
    if (env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Do not export the Cloud service-role key');
    if (env.CONNECTOR_BRIDGE_URL !== `${backend.origin}/functions/v1/chatgpt-connector-bridge`) {
      throw new Error('Bridge must use the configured backend endpoint');
    }
    bridge = { url: env.CONNECTOR_BRIDGE_URL, secret: env.CONNECTOR_BRIDGE_SECRET };
  } else if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing backend credentials');
  for (const url of [publicUrl, appUrl]) {
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use an origin URL');
    if (url.protocol !== 'https:' && !(local && url.hostname === 'localhost' && url.protocol === 'http:')) throw new Error('HTTPS required');
  }
  const redirects = env.CONNECTOR_REDIRECT_URIS.split(',').map(v => v.trim());
  for (const value of redirects) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid redirect URI');
  }
  return { publicUrl: publicUrl.origin, appUrl: appUrl.origin, clientId: env.CONNECTOR_CLIENT_ID,
    redirects, resource: `${publicUrl.origin}/mcp`, bridge };
}

export function validateAuthorization(query, config) {
  if (query.client_id !== config.clientId || !config.redirects.includes(query.redirect_uri)) throw new Error('invalid_client');
  if (query.response_type !== 'code' || query.code_challenge_method !== 'S256' ||
    typeof query.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge)) throw new Error('invalid_request');
  if (query.resource !== config.resource) throw new Error('invalid_target');
  if (typeof query.state !== 'string' || query.state.length < 8 || query.state.length > 2048) throw new Error('invalid_request');
  return { client_id: config.clientId, redirect_uri: query.redirect_uri, resource: config.resource,
    code_challenge: query.code_challenge, state: query.state, scopes: parseScopes(query.scope) };
}

export function authorizationRedirect(request, config, params) {
  const url = new URL(request.redirect_uri);
  url.searchParams.set('state', request.state);
  url.searchParams.set('iss', config.publicUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
