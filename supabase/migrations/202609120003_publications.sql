-- Publishing stays closed until explicitly enabled in both DB and Worker config.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create function airytype_private.mutate_publication(p_operation text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; digest bytea; result jsonb; target uuid; source record; current_publication public.publications;
  expected bigint; publication_expected bigint;
begin
  actor := airytype_private.lock_actor(p_request);
  if not (select publications_enabled from public.service_state) then raise exception 'PUBLISHING_DISABLED'; end if;
  digest := airytype_private.request_digest('publication_' || p_operation,p_request);
  result := airytype_private.replay(actor,p_request,digest);
  if result is not null then return result; end if;
  perform airytype_private.charge_rate(actor);
  target := (p_request->>'note_id')::uuid;
  select n.id,n.title,n.version,n.deleted_at,n.purged_at,c.body into source
  from public.notes n join public.note_contents c on c.note_id = n.id and c.user_id = n.user_id
  where n.id = target and n.user_id = actor;
  if not found or source.deleted_at is not null or source.purged_at is not null then raise exception 'NOTE_NOT_FOUND'; end if;
  if (p_request->>'expected_version') is null or (p_request->>'expected_version') !~ '^[1-9][0-9]*$' then raise exception 'INVALID_VERSION'; end if;
  expected := (p_request->>'expected_version')::bigint;
  if expected <> source.version then raise exception 'VERSION_CONFLICT'; end if;
  select * into current_publication from public.publications where note_id = target and user_id = actor and active;
  if p_operation = 'publish' then
    if current_publication.id is not null then raise exception 'ALREADY_PUBLISHED'; end if;
    insert into public.publications(user_id,note_id,source_version,token,title,body)
    values (actor,target,source.version,encode(extensions.gen_random_bytes(32),'hex'),source.title,source.body)
    returning * into current_publication;
  elsif p_operation in ('update','unpublish') then
    if current_publication.id is null then raise exception 'PUBLICATION_NOT_FOUND'; end if;
    if (p_request->>'publication_version') is null or (p_request->>'publication_version') !~ '^[1-9][0-9]*$' then raise exception 'INVALID_PUBLICATION_VERSION'; end if;
    publication_expected := (p_request->>'publication_version')::bigint;
    if publication_expected <> current_publication.version then raise exception 'PUBLICATION_VERSION_CONFLICT'; end if;
    update public.publications set title = case when p_operation = 'unpublish' then '' else source.title end,
      body = case when p_operation = 'unpublish' then '' else source.body end,
      source_version = source.version,version = version + 1,updated_at = now(),active = p_operation <> 'unpublish'
    where id = current_publication.id and user_id = actor returning * into current_publication;
  else raise exception 'INVALID_OPERATION'; end if;
  perform airytype_private.check_quotas(actor);
  result := jsonb_build_object('epoch',p_request->>'epoch','note_id',target,'token',current_publication.token,
    'publication_version',current_publication.version::text,'source_version',current_publication.source_version::text,
    'active',current_publication.active,'mutation_id',p_request->>'mutation_id');
  insert into public.mutation_receipts(user_id,mutation_id,request_digest,outcome) values (actor,(p_request->>'mutation_id')::uuid,digest,result);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'INVALID_REQUEST';
end;
$$;

create function public.publish_note(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_publication('publish',p_request); $$;
create function public.update_publication(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_publication('update',p_request); $$;
create function public.unpublish_note(p_request jsonb) returns jsonb language sql security definer set search_path = '' as $$ select airytype_private.mutate_publication('unpublish',p_request); $$;

-- The only anonymous content entry point. No private-table grants, no service key.
create function public.read_publication(p_token text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('body',p.body,'title',p.title,'version',p.version::text,'updated_at',p.updated_at)
  from public.publications p
  join public.accounts a on a.user_id = p.user_id
  join auth.users u on u.id = a.user_id
  join public.notes n on n.id = p.note_id and n.user_id = p.user_id
  cross join public.service_state s
  where p_token ~ '^[0-9a-f]{64}$' and p.token = p_token and p.active
    and a.status = 'active' and u.email_confirmed_at is not null
    and n.deleted_at is null and n.purged_at is null and s.reads_enabled and s.publications_enabled;
$$;

revoke execute on function airytype_private.mutate_publication(text,jsonb) from public,anon,authenticated;
revoke execute on function public.publish_note(jsonb),public.update_publication(jsonb),public.unpublish_note(jsonb),public.read_publication(text) from public,anon,authenticated;
grant execute on function public.publish_note(jsonb),public.update_publication(jsonb),public.unpublish_note(jsonb) to authenticated;
grant execute on function public.read_publication(text) to anon,authenticated;
commit;
