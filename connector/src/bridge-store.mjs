import { hash } from "./security.mjs";

// This backend has a narrow bridge credential, never the Cloud service-role key.
export class BridgeStore {
  constructor(authClient, { url, secret, fetchImpl = fetch }) {
    this.authClient = authClient;
    this.url = url;
    this.secret = secret;
    this.fetch = fetchImpl;
  }
  async user(jwt) {
    const { data, error } = await this.authClient.auth.getUser(jwt);
    return error || !data.user || data.user.is_anonymous ? null : data.user.id;
  }
  async call(op, args) {
    const response = await this.fetch(this.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.secret}`,
      },
      body: JSON.stringify({ op, args }),
    });
    if (!response.ok) throw new Error("storage_unavailable");
    const payload = await response.json();
    if (!Object.hasOwn(payload, "result")) {
      throw new Error("storage_unavailable");
    }
    return payload.result;
  }
  createRequest(...args) {
    return this.call("createRequest", args);
  }
  request(...args) {
    return this.call("request", args);
  }
  approve(...args) {
    return this.call("approve", args);
  }
  deny(...args) {
    return this.call("deny", args);
  }
  exchange(...args) {
    return this.call("exchange", args);
  }
  rotate(...args) {
    return this.call("rotate", args);
  }
  authenticate(token) {
    return this.call("authenticateHash", [hash(token)]);
  }
  connections(...args) {
    return this.call("connections", args);
  }
  revoke(...args) {
    return this.call("revoke", args);
  }
  revokeToken(token, clientId) {
    return this.call("revokeHash", [hash(token), clientId]);
  }
  list(table, columns, userId, options = {}) {
    return this.call("list", [table, columns, userId, options]);
  }
  createDraft(...args) {
    return this.call("createDraft", args);
  }
}
