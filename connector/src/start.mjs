import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.mjs';
import { Store } from './store.mjs';
import { BridgeStore } from './bridge-store.mjs';
import { loadConfig } from './security.mjs';

const config = loadConfig(process.env);
const db = createClient(process.env.SUPABASE_URL,
  config.bridge ? process.env.SUPABASE_PUBLISHABLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const store = config.bridge ? new BridgeStore(db, config.bridge) : new Store(db);
const server = createApp(config, store).listen(Number(process.env.PORT || 8787), '0.0.0.0', () => {
  console.log('Scroll Marketer connector listening');
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
