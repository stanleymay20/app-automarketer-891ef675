import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { Store } from '../src/store.mjs';

export const USER = '00000000-0000-4000-8000-000000000001';
export const OTHER = '00000000-0000-4000-8000-000000000002';
export const APP = '00000000-0000-4000-8000-000000000003';
export const OTHER_APP = '00000000-0000-4000-8000-000000000004';

// A narrow PostgREST test adapter executes the actual Store queries/RPCs in Postgres.
const ident = name => { if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid identifier'); return `"${name}"`; };
class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.sorts = []; this.columns = '*'; }
  select(columns = '*') { this.columns = columns; this.returning = true; return this; }
  insert(value) { this.op = 'insert'; this.value = value; return this; }
  update(value) { this.op = 'update'; this.value = value; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(key, value) { this.filters.push([key, '=', value]); return this; }
  gt(key, value) { this.filters.push([key, '>', value]); return this; }
  is(key, value) { this.filters.push([key, 'is', value]); return this; }
  order(key, { ascending = true } = {}) { this.sorts.push(`${ident(key)} ${ascending ? 'asc' : 'desc'}`); return this; }
  range(start, end) { this.offset = start; this.limitValue = end - start + 1; return this; }
  limit(n) { this.limitValue = n; return this; }
  maybeSingle() { this.single = true; return this; }
  async then(resolve, reject) {
    try {
      const values = [], bind = v => { values.push(v); return `$${values.length}`; };
      const columns = this.columns === '*' ? '*' : this.columns.split(',').map(ident).join(',');
      let sql;
      if (this.op === 'insert') {
        sql = `insert into public.${ident(this.table)} (${Object.keys(this.value).map(ident)}) values (${Object.values(this.value).map(bind)})`;
      } else if (this.op === 'update') {
        sql = `update public.${ident(this.table)} set ${Object.entries(this.value).map(([k,v]) => `${ident(k)}=${bind(v)}`)}`;
      } else if (this.op === 'delete') sql = `delete from public.${ident(this.table)}`;
      else sql = `select ${columns} from public.${ident(this.table)}`;
      if (this.filters.length) sql += ' where ' + this.filters.map(([k,op,v]) =>
        `${ident(k)} ${op} ${v === null ? 'null' : bind(v)}`).join(' and ');
      if (this.op) { if (this.returning) sql += ` returning ${columns}`; }
      else {
        if (this.sorts.length) sql += ' order by ' + this.sorts.join(',');
        if (this.limitValue !== undefined) sql += ' limit ' + this.limitValue;
        if (this.offset !== undefined) sql += ' offset ' + this.offset;
      }
      const result = await this.db.query(sql, values);
      return resolve({ data: this.single ? result.rows[0] ?? null : result.rows, error: null });
    } catch (error) { return resolve({ data: null, error }); }
  }
}

export async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to service_role,authenticated,anon;
    grant execute on function auth.uid() to service_role,authenticated,anon;
    insert into auth.users values('${USER}'),('${OTHER}');
    create table public.apps(id uuid primary key,user_id uuid not null references auth.users,
      name text,description text,target_audience text,brand_tone text,platforms text[],website_url text,
      created_at timestamptz default now());
    create table public.content(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users,
      app_id uuid not null references public.apps,platform text not null,content_text text not null,
      status text default 'pending' check(status in ('pending','approved','published','rejected','failed')),
      scheduled_for timestamptz,published_at timestamptz,external_url text,impressions int,engagements int,clicks int,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.campaigns(id uuid primary key default gen_random_uuid(),user_id uuid not null,app_id uuid,
      campaign_name text,active boolean,strategy_summary text,themes text[],platform_mix text[],created_at timestamptz default now());
    create table public.prospects(id uuid primary key default gen_random_uuid(),user_id uuid not null,app_id uuid,
      name text,company_name text,category text,stage text,status text,fit_score int,match_reason text,created_at timestamptz default now());
    grant all on public.apps,public.content to service_role,authenticated;
    grant all on public.campaigns,public.prospects to service_role;
    alter table public.apps enable row level security;
    alter table public.content enable row level security;
    create policy owner_apps on public.apps to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy owner_content on public.content to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    insert into public.apps(id,user_id,name,platforms) values
      ('${APP}','${USER}','ScrollLibrary',array['linkedin','x']),
      ('${OTHER_APP}','${OTHER}','Other account',array['linkedin']);
  `);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  const file = (await readdir(directory)).find(name => name.endsWith('_chatgpt_connector.sql'));
  await db.exec(await readFile(new URL(file, directory), 'utf8'));
  await db.exec('set role service_role');
  const api = { from: table => new Query(db, table), auth: {
    getUser: async jwt => ({ data: { user: jwt === 'test-user-jwt' ? { id: USER } : jwt === 'other-user-jwt' ? { id: OTHER } : null }, error: null }) },
    rpc: async (name, args) => {
      try {
        const pairs = Object.entries(args);
        const sql = `select public.${ident(name)}(${pairs.map(([k],i) => `${ident(k)} => $${i+1}`).join(',')}) as result`;
        const { rows } = await db.query(sql, pairs.map(([,v]) => v));
        return { data: rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    } };
  return { db, store: new Store(api) };
}
