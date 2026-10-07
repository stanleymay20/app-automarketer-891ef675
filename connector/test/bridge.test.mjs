import test from "node:test";
import assert from "node:assert/strict";
import { createBridgeHandler } from "../../supabase/functions/_shared/chatgpt-connector/bridge.mjs";
import { BridgeStore } from "../src/bridge-store.mjs";
import { loadConfig, opaque } from "../src/security.mjs";
import { APP, database, USER } from "./database.mjs";
import { bridgeFixture } from "./bridge-fixture.mjs";

test("bridge rejects unauthorized, browser, generic query, PII and oversized requests before storage", async () => {
  const secret = opaque();
  let calls = 0;
  const handler = createBridgeHandler(
    new Proxy({}, {
      get: () => () => {
        calls++;
        throw new Error("private SQL detail");
      },
    }),
    secret,
  );
  const send = (payload, headers = {}, method = "POST") =>
    handler(
      new Request("https://backend.test/bridge", {
        method,
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          ...headers,
        },
        ...(method === "POST"
          ? {
            body: typeof payload === "string"
              ? payload
              : JSON.stringify(payload),
          }
          : {}),
      }),
    );
  const valid = { op: "authenticateHash", args: ["a".repeat(64)] };
  for (const auth of ["", `Bearer ${opaque()}`, "Bearer test-user-jwt"]) {
    assert.equal((await send(valid, { authorization: auth })).status, 401);
  }
  assert.equal((await send(valid, {}, "OPTIONS")).status, 405);
  assert.equal(
    (await send(valid, { origin: "https://app-automarketer.lovable.app" }))
      .status,
    403,
  );
  assert.equal(
    (await send(valid, { "content-type": "text/plain" })).status,
    400,
  );
  for (
    const invalid of [
      null,
      {},
      { op: "__proto__", args: [] },
      { op: "constructor", args: [] },
      { op: "checked", args: ["SQL"] },
      { op: "user", args: ["JWT"] },
      { ...valid, sql: "drop table content" },
      { op: "list", args: ["mcp_connector_tokens", "*", USER, {}] },
      { op: "list", args: ["prospects", "contact_email", USER, {}] },
      {
        op: "list",
        args: [
          "apps",
          "id,name,description,target_audience,brand_tone,platforms,website_url",
          USER,
          { limit: 101 },
        ],
      },
      { op: "createRequest", args: ["a".repeat(64), { user_id: USER }] },
      { op: "revoke", args: [USER, "bad-id"] },
      {
        op: "createDraft",
        args: [USER, {
          app_id: APP,
          idempotency_key: APP,
          platform: "linkedin",
          content_text: "post",
          status: "approved",
        }],
      },
    ]
  ) {
    assert.equal((await send(invalid)).status, 400);
  }
  assert.equal((await send("x".repeat(100001))).status, 413);
  assert.equal(calls, 0);
  const failed = await send(valid);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "storage_unavailable" });
  assert.throws(() => createBridgeHandler({}, "weak"));
});

test("bridge credential rotation invalidates old secrets; remote client fails closed", async (t) => {
  const { db, store } = await database();
  t.after(() => db.close());
  const b = await bridgeFixture(store);
  t.after(() => b.close());
  assert.ok(Array.isArray(await b.store.connections(USER)));
  const stale = new BridgeStore(store.db, { url: b.url, secret: opaque() });
  await assert.rejects(stale.connections(USER), /storage_unavailable/);
  for (
    const fetchImpl of [
      async () => Response.json({ error: "private" }, { status: 503 }),
      async () => Response.json({ other: true }),
      async () => {
        throw new Error("offline");
      },
    ]
  ) {
    const client = new BridgeStore(store.db, {
      url: b.url,
      secret: b.secret,
      fetchImpl,
    });
    await assert.rejects(client.connections(USER));
  }
});

test("Cloud configuration uses public login key and pins bridge endpoint to its own backend", () => {
  const env = {
    CONNECTOR_PUBLIC_URL: "https://connector.test",
    SCROLLMARKETER_APP_URL: "https://app-automarketer.lovable.app",
    CONNECTOR_CLIENT_ID: "scrollmarketer-chatgpt",
    CONNECTOR_REDIRECT_URIS: "https://chatgpt.com/test-callback",
    SUPABASE_URL: "https://backend.test",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    CONNECTOR_BRIDGE_URL:
      "https://backend.test/functions/v1/chatgpt-connector-bridge",
    CONNECTOR_BRIDGE_SECRET: opaque(),
  };
  assert.equal(loadConfig(env).bridge.url, env.CONNECTOR_BRIDGE_URL);
  for (
    const bad of [
      { SUPABASE_SERVICE_ROLE_KEY: "must-stay-in-cloud" },
      { CONNECTOR_BRIDGE_URL: "https://evil.test/bridge" },
      { CONNECTOR_BRIDGE_SECRET: "weak" },
      { SUPABASE_PUBLISHABLE_KEY: "" },
      { SUPABASE_URL: "http://backend.test" },
    ]
  ) assert.throws(() => loadConfig({ ...env, ...bad }));
});
