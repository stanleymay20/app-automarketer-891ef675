import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.mjs';
import { Store } from './store.mjs';
import { loadConfig } from './security.mjs';

const config = loadConfig(process.env);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const server = createApp(config, new Store(db)).listen(Number(process.env.PORT || 8787), '0.0.0.0', () => {
  console.log('Scroll Marketer connector listening');
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
