import { createHash, timingSafeEqual } from "node:crypto";
const digest = (v) => createHash("sha256").update(v).digest();
const text = (max) => (v) =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const pattern = (re) => (v) => typeof v === "string" && re.test(v);
const hash = pattern(/^[a-f0-9]{64}$/),
  uuid = pattern(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  );
const pkce = pattern(/^[A-Za-z0-9_-]{43}$/);
const https = (v) => {
  try {
    const u = new URL(v);
    return text(4096)(v) && u.protocol === "https:" && !u.username &&
      !u.password && !u.hash;
  } catch {
    return false;
  }
};
const scopes = (v) =>
  Array.isArray(v) && v.length > 0 && v.length <= 2 &&
  new Set(v).size === v.length &&
  v.every((s) => ["marketing:read", "drafts:write"].includes(s));
const integer = (min, max) => (v) =>
  Number.isInteger(v) && v >= min && v <= max;
const optional = (check) => (v) => v === undefined || check(v);
const object = (shape) => (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).every((k) => Object.hasOwn(shape, k)) &&
  Object.entries(shape).every(([k, c]) => c(v[k]));
const tuple = (checks) => (v) =>
  Array.isArray(v) && v.length === checks.length &&
  checks.every((c, i) => c(v[i]));
const options = object({
  app_id: optional(uuid),
  limit: optional(integer(1, 100)),
  offset: optional(integer(0, 100000)),
  status: optional((v) =>
    ["pending", "approved", "published", "rejected", "failed"].includes(v)
  ),
});
// Fixed projections exclude private credentials and prospect contact details.
const projections = {
  apps: [
    "id,name,description,target_audience,brand_tone,platforms,website_url",
  ],
  campaigns: [
    "id,app_id,campaign_name,active,strategy_summary,themes,platform_mix,created_at",
  ],
  content: [
    "id,app_id,platform,content_text,status,scheduled_for,published_at,external_url,created_at",
    "id,app_id,platform,published_at,impressions,engagements,clicks,updated_at",
  ],
  prospects: [
    "id,app_id,name,company_name,category,stage,status,fit_score,match_reason,created_at",
  ],
};
const validators = {
  createRequest: tuple([
    hash,
    object({
      client_id: text(256),
      redirect_uri: https,
      resource: https,
      code_challenge: pkce,
      state: text(2048),
      scopes,
    }),
  ]),
  request: tuple([hash]),
  deny: tuple([hash]),
  approve: tuple([hash, uuid, hash]),
  authenticateHash: tuple([hash]),
  connections: tuple([uuid]),
  revoke: tuple([uuid, uuid]),
  revokeHash: tuple([hash, text(256)]),
  exchange: tuple([
    object({
      p_code_hash: hash,
      p_challenge: pkce,
      p_client_id: text(256),
      p_redirect_uri: https,
      p_resource: https,
      p_access_hash: hash,
      p_refresh_hash: hash,
    }),
  ]),
  rotate: tuple([
    object({
      p_refresh_hash: hash,
      p_client_id: text(256),
      p_resource: https,
      p_access_hash: hash,
      p_new_refresh_hash: hash,
      p_scopes: optional((v) => v === null || scopes(v)),
    }),
  ]),
  list: (a) =>
    tuple([text(32), text(512), uuid, options])(a) &&
    Object.hasOwn(projections, a[0]) && projections[a[0]].includes(a[1]),
  createDraft: tuple([
    uuid,
    object({
      app_id: uuid,
      idempotency_key: uuid,
      platform: (v) => ["linkedin", "x", "instagram", "facebook"].includes(v),
      content_text: (v) => text(20000)(v) && v.trim().length > 0,
    }),
  ]),
};
const reply = (result, status = 200) =>
  Response.json(result, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
export function createBridgeHandler(store, secret) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret || "")) {
    throw new Error("Invalid bridge secret");
  }
  const expected = digest(`Bearer ${secret}`);
  return async (request) => {
    if (request.method !== "POST") {
      return reply({ error: "method_not_allowed" }, 405);
    }
    const auth = request.headers.get("authorization") || "";
    if (auth.length > 256 || !timingSafeEqual(digest(auth), expected)) {
      return reply({ error: "unauthorized" }, 401);
    }
    if (request.headers.get("origin")) {
      return reply({ error: "browser_not_allowed" }, 403);
    }
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
        "application/json"
    ) return reply({ error: "invalid_request" }, 400);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "invalid_request" }, 400);
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 100000) {
          await reader.cancel();
          return reply({ error: "request_too_large" }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      const p = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (
        !object({ op: text(64), args: Array.isArray })(p) ||
        !Object.hasOwn(validators, p.op) || !validators[p.op](p.args)
      ) return reply({ error: "invalid_request" }, 400);
      try {
        return reply({ result: (await store[p.op](...p.args)) ?? null });
      } catch {
        return reply({ error: "storage_unavailable" }, 503);
      }
    } catch {
      return reply({ error: "invalid_request" }, 400);
    } finally {
      reader.releaseLock();
    }
  };
}
