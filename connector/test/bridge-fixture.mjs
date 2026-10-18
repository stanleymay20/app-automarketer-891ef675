import { createServer } from "node:http";
import { once } from "node:events";
import { BridgeStore } from "../src/bridge-store.mjs";
import { opaque } from "../src/security.mjs";
import { createBridgeHandler } from "../../supabase/functions/_shared/chatgpt-connector/bridge.mjs";

export async function bridgeFixture(store) {
  const secret = opaque(), handler = createBridgeHandler(store, secret);
  const server = createServer(async (req, res) => {
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(req.method === "POST" ? { body: req, duplex: "half" } : {}),
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/bridge`;
  return {
    secret,
    url,
    store: new BridgeStore(store.db, { url, secret }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
