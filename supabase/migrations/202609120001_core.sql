-- AiryType protocol 1. Apply through the Supabase migration workflow.
-- No permanent-delete RPC exists: deletion needs an external encrypted receipt.
begin;

create schema if not exists airytype_private;
revoke all on schema airytype_private from public, anon, authenticated;
grant usage on schema airytype_private to authenticated;

create table public.service_state (
  singleton boolean primary key default true check (singleton),
  dataset_epoch uuid not null default gen_random_uuid(),
  minimum_protocol integer not null default 1 check (minimum_protocol > 0),
  reads_enabled boolean not null default true,
  writes_enabled boolean not null default true,
  publications_enabled boolean not null default false
);
insert into public.service_state(singleton) values (true);

create table public.accounts (
  user_id uuid primary key references auth.users(id) on delete restrict,
  status text not null default 'active' check (status in ('active','deleting','suspended')),
  normal_bytes bigint not null default 0,
  recovery_bytes bigint not null default 0,
  checkpoint_bytes bigint not null default 0,
  mutation_window timestamptz not null default now(),
  mutation_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.folders (
  id uuid primary key,
  user_id uuid not null references public.accounts(user_id),
  parent_id uuid,
  name text not null check (char_length(name) <= 80),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id,user_id),
  foreign key (parent_id,user_id) references public.folders(id,user_id)
);
create index folders_owner on public.folders(user_id);

create table public.notes (
  id uuid primary key,
  user_id uuid not null references public.accounts(user_id),
  folder_id uuid,
  title text not null default '' check (char_length(title) <= 200),
  kind text not null default 'normal' check (kind in ('normal','recovery')),
  version bigint not null default 1 check (version > 0),
  body_bytes integer not null check (body_bytes between 0 and 1048576),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purged_at timestamptz,
  unique (id,user_id),
  foreign key (folder_id,user_id) references public.folders(id,user_id)
);
create index notes_owner_updated on public.notes(user_id,updated_at desc,id);

create table public.note_contents (
  note_id uuid primary key,
  user_id uuid not null,
  body text not null check (octet_length(body) <= 1048576),
  foreign key (note_id,user_id) references public.notes(id,user_id)
);

create table public.mutation_receipts (
  user_id uuid not null references public.accounts(user_id),
  mutation_id uuid not null,
  request_digest bytea not null,
  outcome jsonb not null,
  completed_at timestamptz not null default now(),
  primary key (user_id,mutation_id)
);
create index mutation_receipts_expiry on public.mutation_receipts(completed_at);

create table public.note_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  note_id uuid not null,
  source_version bigint not null,
  title text not null,
  body text not null,
  folder_id uuid,
  reason text not null check (reason in ('routine','trash','restore')),
  created_at timestamptz not null default now(),
  foreign key (note_id,user_id) references public.notes(id,user_id),
  unique (note_id,source_version)
);
create index note_revisions_owner_time on public.note_revisions(user_id,created_at);

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  note_id uuid not null,
  source_version bigint not null,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  title text not null,
  body text not null check (octet_length(body) <= 1048576),
  version bigint not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (note_id,user_id) references public.notes(id,user_id)
);
create unique index one_active_publication on public.publications(note_id) where active;

-- Policies call this non-recursive helper; it never trusts JWT email metadata.
create function airytype_private.can_read(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner = auth.uid() and exists (
    select 1 from public.accounts a
    join auth.users u on u.id = a.user_id
    cross join public.service_state s
    where a.user_id = auth.uid() and a.status = 'active'
      and u.email_confirmed_at is not null and s.reads_enabled
  );
$$;

create function airytype_private.create_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.accounts(user_id) values (new.id);
  return new;
end;
$$;
create trigger airytype_account_created after insert on auth.users
for each row execute function airytype_private.create_account();
insert into public.accounts(user_id) select id from auth.users on conflict do nothing;

-- First lock service configuration, then this account. All mutators use this order.
create function airytype_private.lock_actor(p_request jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); s public.service_state; a public.accounts;
begin
  if actor is null then raise exception using message = 'AUTH_REQUIRED', errcode = '42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' then raise exception 'INVALID_REQUEST'; end if;
  select * into s from public.service_state where singleton for share;
  if not found then raise exception using message = 'SERVICE_UNAVAILABLE', errcode = '42501'; end if;
  if not s.reads_enabled or not s.writes_enabled then
    raise exception using message = 'SERVICE_UNAVAILABLE', errcode = '42501';
  end if;
  if (p_request->>'protocol') is null or (p_request->>'protocol') !~ '^[0-9]+$'
    or (p_request->>'protocol')::integer < s.minimum_protocol
    or (p_request->>'protocol')::integer > 1 then
    raise exception 'PROTOCOL_UNSUPPORTED';
  end if;
  if (p_request->>'epoch')::uuid is distinct from s.dataset_epoch then raise exception 'EPOCH_MISMATCH'; end if;
  select * into a from public.accounts where user_id = actor for update;
  if not found or a.status <> 'active' then raise exception using message = 'ACCOUNT_UNAVAILABLE', errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = actor and email_confirmed_at is not null) then
    raise exception using message = 'EMAIL_UNVERIFIED', errcode = '42501';
  end if;
  if (p_request->>'mutation_id')::uuid is null then raise exception 'INVALID_MUTATION_ID'; end if;
  return actor;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'INVALID_REQUEST';
end;
$$;

create function airytype_private.request_digest(p_operation text,p_request jsonb) returns bytea
language sql immutable set search_path = '' as $$
  select sha256(convert_to(jsonb_build_object('operation',p_operation,'request',p_request)::text,'UTF8'));
$$;

create function airytype_private.replay(p_actor uuid,p_request jsonb,p_digest bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare receipt public.mutation_receipts;
begin
  select * into receipt from public.mutation_receipts
  where user_id = p_actor and mutation_id = (p_request->>'mutation_id')::uuid;
  if found then
    if receipt.request_digest <> p_digest then raise exception 'MUTATION_ID_REUSED'; end if;
    return receipt.outcome;
  end if;
  return null;
end;
$$;

create function airytype_private.charge_rate(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.accounts;
begin
  select * into a from public.accounts where user_id = p_actor;
  if a.mutation_window < clock_timestamp() - interval '1 minute' then
    update public.accounts set mutation_window = clock_timestamp(), mutation_count = 1 where user_id = p_actor;
  elsif a.mutation_count >= 240 then
    raise exception 'RATE_LIMITED';
  else
    update public.accounts set mutation_count = mutation_count + 1 where user_id = p_actor;
  end if;
end;
$$;

create function airytype_private.check_quotas(p_actor uuid,p_creating boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare normal_count bigint; live_count bigint; recovery_count bigint; normal_size bigint;
  recovery_size bigint; publication_size bigint; manifest_count bigint;
begin
  select count(*) filter (where kind = 'normal'),
    count(*) filter (where kind = 'normal' and deleted_at is null),
    count(*) filter (where kind = 'recovery'),
    coalesce(sum(body_bytes) filter (where kind = 'normal'),0),
    coalesce(sum(body_bytes) filter (where kind = 'recovery'),0)
  into normal_count,live_count,recovery_count,normal_size,recovery_size
  from public.notes where user_id = p_actor and purged_at is null;
  select coalesce(sum(octet_length(body)),0) into publication_size from public.publications where user_id = p_actor;
  if normal_count > 2000 or live_count > 1000 or normal_size + publication_size > 52428800 then raise exception 'NORMAL_QUOTA_EXCEEDED'; end if;
  if recovery_count > 200 or recovery_size > 10485760 then raise exception 'RECOVERY_QUOTA_EXCEEDED'; end if;
  if (select count(*) from public.folders where user_id = p_actor and deleted_at is null) > 100 then raise exception 'FOLDER_QUOTA_EXCEEDED'; end if;
  if p_creating then
    select (select count(*) from public.notes where user_id = p_actor)
      + (select count(*) from public.folders where user_id = p_actor) into manifest_count;
    if manifest_count > 10000 or octet_length(public.list_manifest()::text) > 2097152 then raise exception 'MANIFEST_CAPACITY_REACHED'; end if;
  end if;
  update public.accounts set normal_bytes = normal_size + publication_size,recovery_bytes = recovery_size where user_id = p_actor;
end;
$$;

create function airytype_private.checkpoint(p_actor uuid,p_note uuid,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare total_bytes bigint; oldest uuid;
begin
  if p_reason <> 'routine' or not exists (
    select 1 from public.note_revisions where note_id = p_note and created_at > now() - interval '30 minutes'
  ) then
    insert into public.note_revisions(user_id,note_id,source_version,title,body,folder_id,reason)
    select n.user_id,n.id,n.version,n.title,c.body,n.folder_id,p_reason
    from public.notes n join public.note_contents c on c.note_id = n.id and c.user_id = n.user_id
    where n.id = p_note and n.user_id = p_actor and n.purged_at is null
    on conflict (note_id,source_version) do nothing;
  end if;
  delete from public.note_revisions where user_id = p_actor and created_at < now() - interval '7 days';
  delete from public.note_revisions where id in (
    select id from public.note_revisions where note_id = p_note order by created_at desc,id desc offset 10
  );
  select coalesce(sum(octet_length(body)),0) into total_bytes from public.note_revisions where user_id = p_actor;
  while total_bytes > 104857600 loop
    select id into oldest from public.note_revisions where user_id = p_actor order by created_at,id limit 1;
    delete from public.note_revisions where id = oldest;
    select coalesce(sum(octet_length(body)),0) into total_bytes from public.note_revisions where user_id = p_actor;
  end loop;
  update public.accounts set checkpoint_bytes = total_bytes where user_id = p_actor;
end;
$$;

-- Internal dispatcher is NOT exposed to browser roles; public wrappers fix operation.
create function airytype_private.mutate_note(p_operation text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; digest bytea; result jsonb; n public.notes; target uuid;
  expected bigint; new_title text; new_body text; new_folder uuid; creating boolean;
  new_kind text := 'normal'; source public.notes;
begin
  actor := airytype_private.lock_actor(p_request);
  digest := airytype_private.request_digest(p_operation,p_request);
  result := airytype_private.replay(actor,p_request,digest);
  if result is not null then return result; end if;
  perform airytype_private.charge_rate(actor);
  target := (p_request->>'note_id')::uuid;
  if target is null then raise exception 'INVALID_NOTE_ID'; end if;
  creating := p_operation in ('create','recover');
  select * into n from public.notes where id = target and user_id = actor;
  if creating then
    if not (p_request ? 'expected_version') or jsonb_typeof(p_request->'expected_version') is distinct from 'null' then raise exception 'EXPECTED_ABSENT_REQUIRED'; end if;
    if exists (select 1 from public.notes where id = target) then raise exception 'NOTE_ALREADY_EXISTS'; end if;
  else
    if n.id is null or n.purged_at is not null then raise exception 'NOTE_NOT_FOUND'; end if;
    if (p_request->>'expected_version') is null or (p_request->>'expected_version') !~ '^[1-9][0-9]*$' then raise exception 'INVALID_VERSION'; end if;
    expected := (p_request->>'expected_version')::bigint;
    if expected <> n.version then raise exception 'VERSION_CONFLICT'; end if;
    if p_operation <> 'restore' and n.deleted_at is not null then raise exception 'NOTE_DELETED'; end if;
    if p_operation = 'restore' and n.deleted_at is null then raise exception 'NOTE_NOT_TRASHED'; end if;
  end if;

  if creating or p_operation = 'save' then
    if jsonb_typeof(p_request->'title') is distinct from 'string' or jsonb_typeof(p_request->'body') is distinct from 'string' then raise exception 'INVALID_NOTE'; end if;
    new_title := p_request->>'title'; new_body := p_request->>'body'; new_folder := (p_request->>'folder_id')::uuid;
    if octet_length(new_body) > 1048576 then raise exception 'NOTE_TOO_LARGE'; end if;
    if p_operation = 'recover' then
      select * into source from public.notes where id = (p_request->>'source_note_id')::uuid and user_id = actor;
      if source.id is null or (p_request->>'source_version') is null or (p_request->>'source_version') !~ '^[1-9][0-9]*$'
        or (p_request->>'source_version')::bigint > source.version then raise exception 'INVALID_RECOVERY_SOURCE'; end if;
      -- Recovery cannot be used as an alternate normal-create allowance.
      if source.deleted_at is null and source.purged_at is null and (p_request->>'source_version')::bigint = source.version then raise exception 'RECOVERY_REQUIRES_DIVERGENCE'; end if;
      new_kind := 'recovery';
      new_title := left(new_title,188) || ' (recovered)';
      if new_folder is not null and not exists (select 1 from public.folders where id = new_folder and user_id = actor and deleted_at is null) then new_folder := null; end if;
    end if;
    if char_length(new_title) > 200 then raise exception 'TITLE_TOO_LONG'; end if;
    if new_folder is not null and not exists (select 1 from public.folders where id = new_folder and user_id = actor and deleted_at is null) then raise exception 'FOLDER_UNAVAILABLE'; end if;
  end if;

  if creating then
    insert into public.notes(id,user_id,folder_id,title,kind,body_bytes)
    values (target,actor,new_folder,new_title,new_kind,octet_length(new_body));
    insert into public.note_contents(note_id,user_id,body) values (target,actor,new_body);
  elsif p_operation = 'save' then
    perform airytype_private.checkpoint(actor,target,'routine');
    update public.notes set title = new_title,folder_id = new_folder,body_bytes = octet_length(new_body),version = version + 1,updated_at = now() where id = target and user_id = actor;
    update public.note_contents set body = new_body where note_id = target and user_id = actor;
  elsif p_operation = 'trash' then
    perform airytype_private.checkpoint(actor,target,'trash');
    update public.notes set deleted_at = now(),version = version + 1,updated_at = now() where id = target and user_id = actor;
    update public.publications set active = false,title = '',body = '',updated_at = now(),version = version + 1 where note_id = target and user_id = actor and active;
  elsif p_operation = 'restore' then
    perform airytype_private.checkpoint(actor,target,'restore');
    update public.notes set deleted_at = null,version = version + 1,updated_at = now(),
      folder_id = case when exists (select 1 from public.folders f where f.id = n.folder_id and f.user_id = actor and f.deleted_at is null) then n.folder_id else null end
    where id = target and user_id = actor;
  else raise exception 'INVALID_OPERATION';
  end if;
  perform airytype_private.check_quotas(actor,creating);
  select jsonb_build_object('epoch',s.dataset_epoch,'note_id',n2.id,'version',n2.version::text,
    'title',n2.title,'folder_id',n2.folder_id,'deleted_at',n2.deleted_at,'kind',n2.kind,
    'mutation_id',p_request->>'mutation_id') into result
  from public.notes n2 cross join public.service_state s where n2.id = target and n2.user_id = actor;
  insert into public.mutation_receipts(user_id,mutation_id,request_digest,outcome)
  values (actor,(p_request->>'mutation_id')::uuid,digest,result);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'INVALID_REQUEST';
end;
$$;

create function public.create_note(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_note('create',p_request); $$;
create function public.save_note(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_note('save',p_request); $$;
create function public.trash_note(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_note('trash',p_request); $$;
create function public.restore_note(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_note('restore',p_request); $$;
create function public.recover_note(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_note('recover',p_request); $$;

create function public.get_service_state() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('epoch',dataset_epoch,'minimum_protocol',minimum_protocol,'reads_enabled',reads_enabled,'writes_enabled',writes_enabled) from public.service_state;
$$;

create function public.get_note(p_note_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('epoch',s.dataset_epoch,'id',n.id,'note_id',n.id,'title',n.title,'body',c.body,
    'folder_id',n.folder_id,'version',n.version::text,'kind',n.kind,'body_bytes',n.body_bytes,
    'deleted_at',n.deleted_at,'purged_at',n.purged_at,'created_at',n.created_at,'updated_at',n.updated_at)
  from public.notes n join public.note_contents c on c.note_id = n.id and c.user_id = n.user_id
  cross join public.service_state s where n.id = p_note_id and airytype_private.can_read(n.user_id) and n.purged_at is null;
$$;

create function public.list_manifest() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('epoch',s.dataset_epoch,
    'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'folder_id',n.folder_id,
      'version',n.version::text,'kind',n.kind,'body_bytes',n.body_bytes,'deleted_at',n.deleted_at,
      'purged_at',n.purged_at,'created_at',n.created_at,'updated_at',n.updated_at) order by n.updated_at desc,n.id)
      from public.notes n where n.user_id = auth.uid()),'[]'::jsonb),
    'folders',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'parent_id',f.parent_id,
      'version',f.version::text,'deleted_at',f.deleted_at,'updated_at',f.updated_at) order by f.name,f.id)
      from public.folders f where f.user_id = auth.uid()),'[]'::jsonb),
    'counts',(select jsonb_build_object('normal_active',count(*) filter (where kind = 'normal' and deleted_at is null and purged_at is null),
      'normal_retained',count(*) filter (where kind = 'normal' and purged_at is null),
      'recovery_retained',count(*) filter (where kind = 'recovery' and purged_at is null),
      'note_tombstones',count(*) filter (where purged_at is not null),
      'folder_active',(select count(*) from public.folders where user_id = auth.uid() and deleted_at is null),
      'folder_tombstones',(select count(*) from public.folders where user_id = auth.uid() and deleted_at is not null))
      from public.notes where user_id = auth.uid()))
  from public.service_state s where airytype_private.can_read(auth.uid());
$$;

create function public.list_revisions(p_note_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'note_id',r.note_id,'source_version',r.source_version::text,
    'title',r.title,'body',r.body,'folder_id',r.folder_id,'reason',r.reason,'created_at',r.created_at) order by r.created_at desc),'[]'::jsonb)
  from public.note_revisions r join public.notes n on n.id = r.note_id and n.user_id = r.user_id
  where r.note_id = p_note_id and airytype_private.can_read(r.user_id) and n.purged_at is null;
$$;

-- No realtime tables are activated here. Reconciliation is authoritative.
-- Only enable metadata insert/update events after a deployed isolation check.
alter table public.service_state enable row level security;
alter table public.accounts enable row level security;
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.note_contents enable row level security;
alter table public.mutation_receipts enable row level security;
alter table public.note_revisions enable row level security;
alter table public.publications enable row level security;

create policy owner_read on public.accounts for select to authenticated using (airytype_private.can_read(user_id));
create policy owner_read on public.folders for select to authenticated using (airytype_private.can_read(user_id));
create policy owner_read on public.notes for select to authenticated using (airytype_private.can_read(user_id));
create policy owner_read on public.note_contents for select to authenticated using (airytype_private.can_read(user_id) and exists (select 1 from public.notes n where n.id = note_id and n.purged_at is null));
create policy owner_read on public.mutation_receipts for select to authenticated using (airytype_private.can_read(user_id));
create policy owner_read on public.note_revisions for select to authenticated using (airytype_private.can_read(user_id) and exists (select 1 from public.notes n where n.id = note_id and n.purged_at is null));
create policy owner_read on public.publications for select to authenticated using (airytype_private.can_read(user_id));

revoke all on public.service_state,public.accounts,public.folders,public.notes,public.note_contents,public.mutation_receipts,public.note_revisions,public.publications from anon,authenticated;
grant select on public.accounts,public.folders,public.notes,public.note_contents,public.mutation_receipts,public.note_revisions,public.publications to authenticated;
revoke execute on all functions in schema airytype_private from public,anon,authenticated;
grant execute on function airytype_private.can_read(uuid) to authenticated;
revoke execute on function public.create_note(jsonb),public.save_note(jsonb),public.trash_note(jsonb),public.restore_note(jsonb),public.recover_note(jsonb),public.get_service_state(),public.get_note(uuid),public.list_manifest(),public.list_revisions(uuid) from public,anon,authenticated;
grant execute on function public.create_note(jsonb),public.save_note(jsonb),public.trash_note(jsonb),public.restore_note(jsonb),public.recover_note(jsonb),public.get_service_state(),public.get_note(uuid),public.list_manifest(),public.list_revisions(uuid) to authenticated;
grant execute on function public.get_service_state() to anon;

commit;
