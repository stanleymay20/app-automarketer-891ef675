import { hash } from './security.mjs';

// All privileged queries carry explicit ownership predicates. No caller controls user_id.
export class Store {
  constructor(db) { this.db = db; }
  async checked(query) {
    const { data, error } = await query;
    if (error) throw new Error('storage_unavailable');
    return data;
  }
  async user(jwt) {
    const { data, error } = await this.db.auth.getUser(jwt);
    if (error || !data.user || data.user.is_anonymous) return null;
    return data.user.id;
  }
  createRequest(requestHash, params) {
    return this.checked(this.db.from('mcp_connector_requests').insert({ request_hash: requestHash, ...params }));
  }
  request(requestHash) {
    return this.checked(this.db.from('mcp_connector_requests').select('*').eq('request_hash', requestHash)
      .gt('expires_at', new Date().toISOString()).is('code_hash', null).is('user_id', null).maybeSingle());
  }
  approve(requestHash, userId, codeHash) {
    return this.checked(this.db.from('mcp_connector_requests').update({ user_id: userId, code_hash: codeHash,
      expires_at: new Date(Date.now() + 120_000).toISOString() }).eq('request_hash', requestHash)
      .gt('expires_at', new Date().toISOString()).is('code_hash', null).is('user_id', null).select('*').maybeSingle());
  }
  deny(requestHash) {
    return this.checked(this.db.from('mcp_connector_requests').delete().eq('request_hash', requestHash)
      .is('code_hash', null).is('user_id', null).select('*').maybeSingle());
  }
  exchange(params) { return this.checked(this.db.rpc('mcp_connector_exchange', params)); }
  rotate(params) { return this.checked(this.db.rpc('mcp_connector_refresh', params)); }
  authenticate(token) {
    return this.checked(this.db.rpc('mcp_connector_authenticate', { p_token_hash: hash(token) }));
  }
  connections(userId) {
    return this.checked(this.db.from('mcp_connector_grants').select('id,client_id,scopes,created_at,expires_at,revoked_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(100));
  }
  revoke(userId, id) {
    return this.checked(this.db.from('mcp_connector_grants').update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId).eq('id', id));
  }
  async revokeToken(token, clientId) {
    // OAuth revocation accepts either an access token or a refresh token.
    await this.checked(this.db.rpc('mcp_connector_revoke', { p_token_hash: hash(token), p_client_id: clientId }));
  }
  async list(table, columns, userId, { app_id, limit = 25, offset = 0, status } = {}) {
    let query = this.db.from(table).select(columns).eq('user_id', userId);
    if (app_id) query = query.eq('app_id', app_id);
    if (status) query = query.eq('status', status);
    const rows = await this.checked(query.order('created_at', { ascending: false }).order('id')
      .range(offset, offset + limit));
    return { records: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null };
  }
  createDraft(userId, args) {
    return this.checked(this.db.rpc('mcp_connector_create_draft', { p_user_id: userId,
      p_app_id: args.app_id, p_key: args.idempotency_key, p_platform: args.platform, p_text: args.content_text }));
  }
}
