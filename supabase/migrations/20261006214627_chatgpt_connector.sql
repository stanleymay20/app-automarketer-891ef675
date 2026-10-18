-- Private connector credentials; only the server service role may access these tables.
create table public.mcp_connector_requests (
  request_hash text primary key check (request_hash ~ '^[a-f0-9]{64}$'),
  client_id text not null,
  redirect_uri text not null,
  resource text not null,
  state text not null,
  code_challenge text not null,
  scopes text[] not null check (scopes <@ array['marketing:read','drafts:write']::text[] and cardinality(scopes) > 0),
  user_id uuid references auth.users(id) on delete cascade,
  code_hash text unique,
  expires_at timestamptz not null default (now() + interval '10 minutes')
);
create table public.mcp_connector_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  resource text not null,
  scopes text[] not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz
);
create table public.mcp_connector_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  grant_id uuid not null references public.mcp_connector_grants(id) on delete cascade,
  kind text not null check (kind in ('access','refresh')),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create table public.mcp_connector_drafts (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  content_id uuid not null references public.content(id) on delete cascade,
  -- Retain the original payload so retries remain stable even after a user edits the draft.
  app_id uuid not null,
  platform text not null,
  content_text text not null,
  primary key (user_id,idempotency_key)
);
create index mcp_connector_grants_user_idx on public.mcp_connector_grants(user_id);
create index mcp_connector_tokens_grant_idx on public.mcp_connector_tokens(grant_id);
create index mcp_connector_requests_expiry_idx on public.mcp_connector_requests(expires_at);

alter table public.mcp_connector_requests enable row level security;
alter table public.mcp_connector_grants enable row level security;
alter table public.mcp_connector_tokens enable row level security;
alter table public.mcp_connector_drafts enable row level security;
revoke all on public.mcp_connector_requests, public.mcp_connector_grants,
  public.mcp_connector_tokens, public.mcp_connector_drafts from public, anon, authenticated;
grant all on public.mcp_connector_requests, public.mcp_connector_grants,
  public.mcp_connector_tokens, public.mcp_connector_drafts to service_role;

-- These RPCs are SECURITY INVOKER and callable only by service_role.
-- Code consumption and token issuance commit together, preventing replay/race issuance.
create function public.mcp_connector_exchange(
  p_code_hash text, p_challenge text, p_client_id text, p_redirect_uri text,
  p_resource text, p_access_hash text, p_refresh_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.mcp_connector_requests; g public.mcp_connector_grants;
begin
  delete from public.mcp_connector_requests
    where code_hash=p_code_hash and code_challenge=p_challenge and client_id=p_client_id
      and redirect_uri=p_redirect_uri and resource=p_resource and expires_at>now() and user_id is not null
    returning * into r;
  if not found then return null; end if;
  insert into public.mcp_connector_grants(user_id,client_id,resource,scopes)
    values(r.user_id,r.client_id,r.resource,r.scopes) returning * into g;
  insert into public.mcp_connector_tokens(token_hash,grant_id,kind,expires_at) values
    (p_access_hash,g.id,'access',now()+interval '1 hour'),(p_refresh_hash,g.id,'refresh',g.expires_at);
  return jsonb_build_object('scopes',g.scopes);
end $$;

create function public.mcp_connector_refresh(
  p_refresh_hash text,p_client_id text,p_resource text,p_access_hash text,p_new_refresh_hash text,p_scopes text[] default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare t public.mcp_connector_tokens; g public.mcp_connector_grants;
begin
  select * into t from public.mcp_connector_tokens
    where token_hash=p_refresh_hash and kind='refresh' for update;
  if not found then return null; end if;
  select * into g from public.mcp_connector_grants where id=t.grant_id
    and client_id=p_client_id and resource=p_resource and revoked_at is null and expires_at>now() for update;
  if not found or t.expires_at<=now() then return null; end if;
  if p_scopes is not null and not (p_scopes <@ g.scopes and g.scopes <@ p_scopes) then return null; end if;
  if t.consumed_at is not null then
    update public.mcp_connector_grants set revoked_at=now() where id=g.id;
    return null; -- Refresh replay invalidates the entire grant family.
  end if;
  update public.mcp_connector_tokens set consumed_at=now() where token_hash=p_refresh_hash;
  insert into public.mcp_connector_tokens(token_hash,grant_id,kind,expires_at) values
    (p_access_hash,g.id,'access',least(g.expires_at,now()+interval '1 hour')),
    (p_new_refresh_hash,g.id,'refresh',g.expires_at);
  return jsonb_build_object('scopes',g.scopes);
end $$;

create function public.mcp_connector_authenticate(p_token_hash text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('user_id',g.user_id,'client_id',g.client_id,'resource',g.resource,'scopes',g.scopes)
  from public.mcp_connector_tokens t join public.mcp_connector_grants g on g.id=t.grant_id
  where t.token_hash=p_token_hash and t.kind='access' and t.expires_at>now()
    and g.expires_at>now() and g.revoked_at is null;
$$;

alter table public.content add column connector_requires_review boolean not null default false;
create function public.mcp_connector_revoke(p_token_hash text,p_client_id text)
returns void language sql security invoker set search_path = '' as $$
  update public.mcp_connector_grants g set revoked_at=now()
    from public.mcp_connector_tokens t where t.grant_id=g.id and t.token_hash=p_token_hash and g.client_id=p_client_id;
$$;
-- Authenticated owner approval from the existing app is allowed; service/cron auto-approval is blocked.
create function public.mcp_connector_manual_review()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.connector_requires_review and (
    (new.status='approved' and old.status is distinct from 'approved')
    or not new.connector_requires_review
  ) and auth.uid() is distinct from old.user_id then
    raise exception 'Connector drafts require authenticated owner approval';
  end if;
  return new;
end $$;
create trigger mcp_connector_manual_review before update on public.content
  for each row execute function public.mcp_connector_manual_review();

create function public.mcp_connector_create_draft(
  p_user_id uuid,p_app_id uuid,p_key uuid,p_platform text,p_text text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.mcp_connector_drafts; c public.content;
begin
  if p_text is null or length(btrim(p_text))=0 or length(p_text)>20000
    or p_platform not in ('linkedin','x','instagram','facebook') then raise exception 'Invalid draft'; end if;
  -- Serialize retries before checking/creating the mapping.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_key::text,0));
  if not exists(select 1 from public.apps where id=p_app_id and user_id=p_user_id
    and p_platform=any(platforms)) then raise exception 'Offering/platform unavailable'; end if;
  select * into d from public.mcp_connector_drafts where user_id=p_user_id and idempotency_key=p_key;
  if found then
    if d.app_id<>p_app_id or d.platform<>p_platform or d.content_text<>p_text then
      raise exception 'Idempotency key reused with different payload';
    end if;
    select * into c from public.content where id=d.content_id and user_id=p_user_id;
  else
    insert into public.content(user_id,app_id,platform,content_text,status,scheduled_for,connector_requires_review)
      values(p_user_id,p_app_id,p_platform,p_text,'pending',null,true) returning * into c;
    insert into public.mcp_connector_drafts(user_id,idempotency_key,content_id,app_id,platform,content_text)
      values(p_user_id,p_key,c.id,p_app_id,p_platform,p_text);
  end if;
  return jsonb_build_object('id',c.id,'app_id',c.app_id,'platform',c.platform,'content_text',c.content_text,
    'status',c.status,'scheduled_for',c.scheduled_for,'review_required',c.connector_requires_review);
end $$;

revoke execute on function public.mcp_connector_exchange(text,text,text,text,text,text,text),
  public.mcp_connector_refresh(text,text,text,text,text,text[]),public.mcp_connector_authenticate(text),
  public.mcp_connector_revoke(text,text),
  public.mcp_connector_create_draft(uuid,uuid,uuid,text,text),public.mcp_connector_manual_review()
  from public, anon, authenticated;
grant execute on function public.mcp_connector_exchange(text,text,text,text,text,text,text),
  public.mcp_connector_refresh(text,text,text,text,text,text[]),public.mcp_connector_authenticate(text),
  public.mcp_connector_revoke(text,text),
  public.mcp_connector_create_draft(uuid,uuid,uuid,text,text) to service_role;
