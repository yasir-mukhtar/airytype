begin;

create function airytype_private.mutate_folder(p_operation text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; digest bytea; result jsonb; target uuid; parent uuid; f public.folders;
  expected bigint; new_name text; parent_depth integer; subtree_depth integer;
begin
  actor := airytype_private.lock_actor(p_request);
  digest := airytype_private.request_digest('folder_' || p_operation,p_request);
  result := airytype_private.replay(actor,p_request,digest);
  if result is not null then return result; end if;
  perform airytype_private.charge_rate(actor);
  target := (p_request->>'folder_id')::uuid;
  if target is null then raise exception 'INVALID_FOLDER_ID'; end if;
  select * into f from public.folders where id = target and user_id = actor;
  if p_operation = 'create' then
    if not (p_request ? 'expected_version') or jsonb_typeof(p_request->'expected_version') is distinct from 'null' then raise exception 'EXPECTED_ABSENT_REQUIRED'; end if;
    if exists (select 1 from public.folders where id = target) then raise exception 'FOLDER_ALREADY_EXISTS'; end if;
  else
    if f.id is null or f.deleted_at is not null then raise exception 'FOLDER_UNAVAILABLE'; end if;
    if (p_request->>'expected_version') is null or (p_request->>'expected_version') !~ '^[1-9][0-9]*$' then raise exception 'INVALID_VERSION'; end if;
    expected := (p_request->>'expected_version')::bigint;
    if expected <> f.version then raise exception 'VERSION_CONFLICT'; end if;
  end if;
  if p_operation = 'delete' then
    if exists (select 1 from public.folders where parent_id = target and user_id = actor and deleted_at is null)
      or exists (select 1 from public.notes where folder_id = target and user_id = actor and deleted_at is null and purged_at is null) then raise exception 'FOLDER_NOT_EMPTY'; end if;
    update public.folders set name = '',parent_id = null,deleted_at = now(),updated_at = now(),version = version + 1 where id = target and user_id = actor;
  elsif p_operation in ('create','update') then
    new_name := p_request->>'name'; parent := (p_request->>'parent_id')::uuid;
    if jsonb_typeof(p_request->'name') is distinct from 'string' or char_length(trim(new_name)) = 0 or char_length(new_name) > 80 then raise exception 'INVALID_FOLDER_NAME'; end if;
    if parent is not null and not exists (select 1 from public.folders where id = parent and user_id = actor and deleted_at is null) then raise exception 'PARENT_UNAVAILABLE'; end if;
    if parent = target then raise exception 'FOLDER_CYCLE'; end if;
    if parent is not null and exists (
      with recursive children as (
        select id from public.folders where parent_id = target and user_id = actor and deleted_at is null
        union all select c.id from public.folders c join children p on c.parent_id = p.id where c.user_id = actor and c.deleted_at is null
      ) select 1 from children where id = parent
    ) then raise exception 'FOLDER_CYCLE'; end if;
    with recursive ancestors as (
      select id,parent_id,1 depth from public.folders where id = parent and user_id = actor
      union all select f2.id,f2.parent_id,a.depth + 1 from public.folders f2 join ancestors a on f2.id = a.parent_id where f2.user_id = actor
    ) select coalesce(max(depth),0) into parent_depth from ancestors;
    with recursive children as (
      select id,1 depth from public.folders where parent_id = target and user_id = actor and deleted_at is null
      union all select f2.id,c.depth + 1 from public.folders f2 join children c on f2.parent_id = c.id where f2.user_id = actor and f2.deleted_at is null
    ) select coalesce(max(depth),0) into subtree_depth from children;
    if parent_depth + 1 + subtree_depth > 3 then raise exception 'FOLDER_DEPTH_EXCEEDED'; end if;
    if p_operation = 'create' then
      insert into public.folders(id,user_id,parent_id,name) values (target,actor,parent,new_name);
    else
      update public.folders set parent_id = parent,name = new_name,version = version + 1,updated_at = now() where id = target and user_id = actor;
    end if;
  else raise exception 'INVALID_OPERATION'; end if;
  perform airytype_private.check_quotas(actor,p_operation = 'create');
  select jsonb_build_object('epoch',s.dataset_epoch,'folder_id',f2.id,'name',f2.name,'parent_id',f2.parent_id,
    'version',f2.version::text,'deleted_at',f2.deleted_at,'mutation_id',p_request->>'mutation_id') into result
  from public.folders f2 cross join public.service_state s where f2.id = target and f2.user_id = actor;
  insert into public.mutation_receipts(user_id,mutation_id,request_digest,outcome) values (actor,(p_request->>'mutation_id')::uuid,digest,result);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'INVALID_REQUEST';
end;
$$;

create function public.create_folder(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_folder('create',p_request); $$;
create function public.update_folder(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_folder('update',p_request); $$;
create function public.delete_folder(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_folder('delete',p_request); $$;

-- Literal token search: strpos treats %, _, quotes, and backslashes as text.
-- Continuation describes the unfiltered server page, independent of local overlays.
create function public.search_notes(p_query text,p_offset integer default 0,p_limit integer default 20,p_trash boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; tokens text[];
begin
  if not airytype_private.can_read(auth.uid()) then raise exception using message = 'ACCOUNT_UNAVAILABLE', errcode = '42501'; end if;
  if p_query is null or char_length(p_query) > 200 or p_offset is null or p_offset < 0 or p_offset > 10000 or p_limit is null or p_limit < 1 or p_limit > 50 or p_trash is null then raise exception 'INVALID_SEARCH'; end if;
  select coalesce(array_agg(token),'{}') into tokens from (
    select token from regexp_split_to_table(lower(trim(p_query)),'\s+') token where token <> '' limit 5
  ) words;
  with matches as (
    select n.id,n.title,n.kind,n.folder_id,n.version,n.updated_at,c.body,
      case when not exists (select 1 from unnest(tokens) t where strpos(lower(n.title),t) = 0) then 0
        when exists (select 1 from unnest(tokens) t where strpos(lower(n.title),t) > 0) then 1 else 2 end rank
    from public.notes n join public.note_contents c on c.note_id = n.id and c.user_id = n.user_id
    where n.user_id = auth.uid() and n.purged_at is null and (n.deleted_at is not null) = p_trash
      and not exists (select 1 from unnest(tokens) t where strpos(lower(n.title || E'\n' || c.body),t) = 0)
  ), page as (
    select * from matches order by rank,updated_at desc,id offset p_offset limit p_limit + 1
  ), visible as (
    select * from page order by rank,updated_at desc,id limit p_limit
  ) select jsonb_build_object('epoch',s.dataset_epoch,'results',coalesce((
    select jsonb_agg(jsonb_build_object('id',id,'title',title,'kind',kind,'folder_id',folder_id,'version',version::text,
      'updated_at',updated_at,'snippet',left(body,180)) order by rank,updated_at desc,id) from visible),'[]'::jsonb),
    'next_offset',case when (select count(*) from page) > p_limit then p_offset + p_limit else null end)
  into result from public.service_state s;
  return result;
end;
$$;

-- Bounded cleanup is admin-only; invoke daily from the operator's scheduler.
create function airytype_private.cleanup_receipts(p_limit integer default 1000) returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if p_limit < 1 or p_limit > 10000 then raise exception 'INVALID_LIMIT'; end if;
  delete from public.mutation_receipts where (user_id,mutation_id) in (
    select user_id,mutation_id from public.mutation_receipts where completed_at < now() - interval '7 days'
    order by completed_at limit p_limit
  );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function airytype_private.mutate_folder(text,jsonb),airytype_private.cleanup_receipts(integer) from public,anon,authenticated;
revoke execute on function public.create_folder(jsonb),public.update_folder(jsonb),public.delete_folder(jsonb),public.search_notes(text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.create_folder(jsonb),public.update_folder(jsonb),public.delete_folder(jsonb),public.search_notes(text,integer,integer,boolean) to authenticated;
commit;
