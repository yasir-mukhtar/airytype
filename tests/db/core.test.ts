import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type Json = Record<string, unknown>;
let db: PGlite;
let actor: string;
let other: string;
let unverified: string;
let epoch: string;

async function admin(sql: string, parameters: unknown[] = []): Promise<void> {
  await db.exec('reset role');
  await db.query(sql, parameters);
}

async function asUser(userId: string, role = 'authenticated'): Promise<void> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    userId,
  ]);
  await db.exec(`set role ${role}`);
}

async function rpc(name: string, payload?: Json): Promise<Json> {
  const query = payload
    ? `select public.${name}($1::jsonb) as result`
    : `select public.${name}() as result`;
  const response = await db.query<{ result: Json }>(
    query,
    payload ? [JSON.stringify(payload)] : [],
  );
  return response.rows[0].result;
}

function request(overrides: Json = {}): Json {
  return {
    protocol: 1,
    epoch,
    mutation_id: randomUUID(),
    note_id: randomUUID(),
    expected_version: null,
    title: 'Draft',
    body: 'Original',
    folder_id: null,
    ...overrides,
  };
}

async function note(noteId: unknown): Promise<Json | null> {
  const response = await db.query<{ result: Json | null }>(
    'select public.get_note($1::uuid) as result',
    [noteId],
  );
  return response.rows[0].result;
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(
    await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'),
  );
  for (const migration of [
    '202609120001_core.sql',
    '202609120002_organization.sql',
    '202609120003_publications.sql',
  ]) {
    await db.exec(
      await readFile(
        new URL(`../../supabase/migrations/${migration}`, import.meta.url),
        'utf8',
      ),
    );
  }
}, 30_000);

beforeEach(async () => {
  actor = randomUUID();
  other = randomUUID();
  unverified = randomUUID();
  await admin(
    'update public.service_state set reads_enabled = true,writes_enabled = true,minimum_protocol = 1,publications_enabled = false',
  );
  await admin(
    'insert into auth.users(id,email_confirmed_at) values ($1,now()),($2,now()),($3,null)',
    [actor, other, unverified],
  );
  const state = await db.query<{ dataset_epoch: string }>(
    'select dataset_epoch from public.service_state',
  );
  epoch = state.rows[0].dataset_epoch;
  await asUser(actor);
});

afterAll(async () => {
  await db?.close();
});

describe('PostgreSQL core mutation and isolation contract', () => {
  it('returns a joined exact title/body/version snapshot and keeps receipts body-free', async () => {
    const create = request({
      body: 'Indonesian: satu.\nUnicode: 👨‍👩‍👧‍👦 é',
      title: 'A title',
    });
    const acknowledgement = await rpc('create_note', create);
    expect(acknowledgement.version).toBe('1');
    expect(acknowledgement).not.toHaveProperty('body');
    expect(await note(create.note_id)).toMatchObject({
      title: create.title,
      body: create.body,
      version: '1',
      epoch,
    });
    const receipt = await db.query<{ outcome: Json }>(
      'select outcome from public.mutation_receipts',
    );
    expect(receipt.rows).toHaveLength(1);
    expect(receipt.rows[0].outcome).not.toHaveProperty('body');
  });

  it('replays a lost acknowledgement exactly even after a later save; changed payloads fail', async () => {
    const create = request();
    const first = await rpc('create_note', create);
    const save = request({
      note_id: create.note_id,
      expected_version: '1',
      body: 'Second',
    });
    const second = await rpc('save_note', save);
    await rpc(
      'save_note',
      request({
        note_id: create.note_id,
        expected_version: '2',
        body: 'Third',
      }),
    );
    expect(await rpc('create_note', create)).toEqual(first);
    expect(await rpc('save_note', save)).toEqual(second);
    expect(await note(create.note_id)).toMatchObject({
      body: 'Third',
      version: '3',
    });
    await expect(
      rpc('save_note', { ...save, body: 'Changed replay' }),
    ).rejects.toThrow('MUTATION_ID_REUSED');
    expect(await note(create.note_id)).toMatchObject({
      body: 'Third',
      version: '3',
    });
  });

  it('rejects stale or missing saves without upserting or overwriting', async () => {
    const create = request();
    await rpc('create_note', create);
    await rpc(
      'save_note',
      request({
        note_id: create.note_id,
        expected_version: '1',
        body: 'Accepted',
      }),
    );
    await expect(
      rpc(
        'save_note',
        request({
          note_id: create.note_id,
          expected_version: '1',
          body: 'Stale',
        }),
      ),
    ).rejects.toThrow('VERSION_CONFLICT');
    await expect(
      rpc('save_note', request({ expected_version: '1' })),
    ).rejects.toThrow('NOTE_NOT_FOUND');
    await expect(
      rpc('create_note', request({ note_id: create.note_id })),
    ).rejects.toThrow('NOTE_ALREADY_EXISTS');
    expect(await note(create.note_id)).toMatchObject({
      body: 'Accepted',
      version: '2',
    });
  });

  it('isolates owner reads across all private tables and narrow RPCs', async () => {
    const create = request();
    await rpc('create_note', create);
    await rpc(
      'save_note',
      request({
        note_id: create.note_id,
        expected_version: '1',
        body: 'Private revision',
      }),
    );
    await asUser(other);
    expect(await note(create.note_id)).toBe(null);
    expect((await rpc('list_manifest')).notes).toEqual([]);
    for (const table of [
      'notes',
      'note_contents',
      'folders',
      'mutation_receipts',
      'note_revisions',
      'publications',
    ]) {
      expect((await db.query(`select * from public.${table}`)).rows).toEqual(
        [],
      );
    }
    await expect(
      rpc(
        'save_note',
        request({ note_id: create.note_id, expected_version: '2' }),
      ),
    ).rejects.toThrow('NOTE_NOT_FOUND');
    const search = await db.query<{ result: Json }>(
      "select public.search_notes('Private') as result",
    );
    expect(search.rows[0].result.results).toEqual([]);
  });

  it('denies direct table writes even to the owner and denies private anonymous access', async () => {
    const create = request();
    await rpc('create_note', create);
    await expect(
      db.query("update public.notes set title = 'bypass' where id = $1", [
        create.note_id,
      ]),
    ).rejects.toThrow('permission denied');
    await expect(
      db.query('delete from public.notes where id = $1', [create.note_id]),
    ).rejects.toThrow('permission denied');
    await expect(
      db.query("select airytype_private.mutate_note('create',$1::jsonb)", [
        JSON.stringify(request()),
      ]),
    ).rejects.toThrow('permission denied');
    await asUser('', 'anon');
    await expect(
      db.query('select * from public.note_contents'),
    ).rejects.toThrow('permission denied');
    await expect(rpc('create_note', request())).rejects.toThrow(
      'permission denied',
    );
    expect((await rpc('get_service_state')).epoch).toBe(epoch);
  });

  it('keeps every internal definer inaccessible and pins its search path', async () => {
    const functions = await db.query<{
      proname: string;
      authenticated_execute: boolean;
      anon_execute: boolean;
      proconfig: string[];
    }>(`
      select p.proname,has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
        has_function_privilege('anon',p.oid,'execute') anon_execute,p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'airytype_private' and p.prosecdef
    `);
    for (const fn of functions.rows) {
      expect(fn.authenticated_execute, fn.proname).toBe(
        fn.proname === 'can_read',
      );
      expect(fn.anon_execute, fn.proname).toBe(false);
      expect(fn.proconfig, fn.proname).toContain('search_path=""');
    }
    await expect(
      db.query('select * from public.service_state'),
    ).rejects.toThrow('permission denied');
    await expect(
      db.query('update public.service_state set writes_enabled = true'),
    ).rejects.toThrow('permission denied');
  });

  it('uses verified Auth state and current lifecycle rather than caller metadata', async () => {
    await asUser(unverified);
    await expect(
      rpc('create_note', request({ email_verified: true })),
    ).rejects.toThrow('EMAIL_UNVERIFIED');
    expect(await rpc('list_manifest')).toBe(null);
    await asUser(actor);
    const create = request();
    await rpc('create_note', create);
    await admin(
      "update public.accounts set status = 'deleting' where user_id = $1",
      [actor],
    );
    await asUser(actor);
    expect(await note(create.note_id)).toBe(null);
    expect((await db.query('select * from public.notes')).rows).toEqual([]);
    await expect(rpc('create_note', create)).rejects.toThrow(
      'ACCOUNT_UNAVAILABLE',
    );
  });

  it('maintenance blocks private direct reads and new writes, including receipt replay', async () => {
    const create = request();
    await rpc('create_note', create);
    await admin('update public.service_state set writes_enabled = false');
    await asUser(actor);
    expect(await note(create.note_id)).not.toBe(null);
    await expect(rpc('create_note', create)).rejects.toThrow(
      'SERVICE_UNAVAILABLE',
    );
    await admin('update public.service_state set reads_enabled = false');
    await asUser(actor);
    expect(await note(create.note_id)).toBe(null);
    expect(await rpc('list_manifest')).toBe(null);
    expect((await db.query('select * from public.note_contents')).rows).toEqual(
      [],
    );
  });

  it('requires current immutable epoch and supported protocol even for accepted receipts', async () => {
    const create = request();
    await rpc('create_note', create);
    await expect(
      rpc('create_note', request({ epoch: randomUUID() })),
    ).rejects.toThrow('EPOCH_MISMATCH');
    await expect(rpc('create_note', request({ protocol: 2 }))).rejects.toThrow(
      'PROTOCOL_UNSUPPORTED',
    );
    await admin(
      'update public.service_state set dataset_epoch = gen_random_uuid()',
    );
    await asUser(actor);
    await expect(rpc('create_note', create)).rejects.toThrow('EPOCH_MISMATCH');
  });

  it('trashes versionedly, preserves recovery checkpoints, and never saves into trash', async () => {
    const create = request();
    await rpc('create_note', create);
    await rpc(
      'trash_note',
      request({ note_id: create.note_id, expected_version: '1' }),
    );
    expect(await note(create.note_id)).toMatchObject({
      body: 'Original',
      version: '2',
    });
    await expect(
      rpc(
        'save_note',
        request({ note_id: create.note_id, expected_version: '2' }),
      ),
    ).rejects.toThrow('NOTE_DELETED');
    await rpc(
      'restore_note',
      request({ note_id: create.note_id, expected_version: '2' }),
    );
    expect(await note(create.note_id)).toMatchObject({
      body: 'Original',
      version: '3',
      deleted_at: null,
    });
    const revisions = await db.query<{ result: Json[] }>(
      'select public.list_revisions($1) as result',
      [create.note_id],
    );
    expect(revisions.rows[0].result.map((r) => r.source_version)).toEqual([
      '2',
      '1',
    ]);
  });

  it('preserves divergent recovery with canonical title and unavailable-folder fallback', async () => {
    const create = request();
    await rpc('create_note', create);
    await rpc(
      'save_note',
      request({
        note_id: create.note_id,
        expected_version: '1',
        body: 'Other device',
      }),
    );
    const recovery = request({
      source_note_id: create.note_id,
      source_version: '1',
      title: '😀'.repeat(200),
      body: 'My pending text',
      folder_id: randomUUID(),
    });
    const result = await rpc('recover_note', recovery);
    expect(result.kind).toBe('recovery');
    expect(result.folder_id).toBe(null);
    expect(Array.from(String(result.title))).toHaveLength(200);
    expect(await note(create.note_id)).toMatchObject({ body: 'Other device' });
    expect(await note(recovery.note_id)).toMatchObject({
      body: 'My pending text',
      kind: 'recovery',
    });
    expect(await rpc('recover_note', recovery)).toEqual(result);
  });

  it('checks UTF-8 bytes, code-point title limits and rate budget atomically', async () => {
    await expect(
      rpc('create_note', request({ body: '😀'.repeat(262145) })),
    ).rejects.toThrow('NOTE_TOO_LARGE');
    await expect(
      rpc('create_note', request({ title: '😀'.repeat(201) })),
    ).rejects.toThrow('TITLE_TOO_LONG');
    const create = request({ title: '😀'.repeat(200) });
    await rpc('create_note', create);
    await admin(
      'update public.accounts set mutation_count = 240,mutation_window = now() where user_id = $1',
      [actor],
    );
    await asUser(actor);
    await expect(rpc('create_note', request())).rejects.toThrow('RATE_LIMITED');
    expect((await rpc('create_note', create)).version).toBe('1'); // Receipt replay is not charged twice.
  });

  it('enforces active count quota and rolls back rejected creates completely', async () => {
    await admin(
      `with seeded as (
      insert into public.notes(id,user_id,title,body_bytes)
      select gen_random_uuid(),$1,'Seed',0 from generate_series(1,1000) returning id,user_id
    ) insert into public.note_contents(note_id,user_id,body) select id,user_id,'' from seeded`,
      [actor],
    );
    await asUser(actor);
    const create = request();
    await expect(rpc('create_note', create)).rejects.toThrow(
      'NORMAL_QUOTA_EXCEEDED',
    );
    expect(await note(create.note_id)).toBe(null);
    expect(
      (await db.query('select * from public.mutation_receipts')).rows,
    ).toHaveLength(0);
    expect((await rpc('list_manifest')).counts).toMatchObject({
      normal_active: 1000,
      normal_retained: 1000,
    });
  });

  it('never grants ordinary clients a physical purge or deletion bypass', async () => {
    const functions = await db.query<{ proname: string }>(
      "select proname from pg_proc where pronamespace = 'public'::regnamespace and proname ~ '(purge|delete_account|delete_note)'",
    );
    expect(functions.rows).toEqual([]);
    for (const table of [
      'notes',
      'note_contents',
      'note_revisions',
      'accounts',
    ]) {
      await expect(db.query(`delete from public.${table}`)).rejects.toThrow(
        'permission denied',
      );
    }
  });

  it('requires an explicit expected-absent marker and rejects malformed input without echoing it', async () => {
    const missingAbsent = request();
    delete missingAbsent.expected_version;
    await expect(rpc('create_note', missingAbsent)).rejects.toThrow(
      'EXPECTED_ABSENT_REQUIRED',
    );
    const sentinel = 'PRIVATE-DRAFT-MUST-NOT-APPEAR-IN-ERRORS';
    for (const bad of [
      request({ note_id: sentinel }),
      request({ mutation_id: sentinel }),
      request({ epoch: sentinel }),
      request({ protocol: '99999999999999999999999999999999999999999999' }),
    ]) {
      await expect(rpc('create_note', bad)).rejects.toThrow('INVALID_REQUEST');
    }
    await expect(
      db.query('select public.create_note($1::jsonb)', ['[]']),
    ).rejects.toThrow('INVALID_REQUEST');
    expect((await db.query('select * from public.notes')).rows).toHaveLength(0);
    expect(
      (await db.query('select * from public.mutation_receipts')).rows,
    ).toHaveLength(0);
  });

  it('checks present verification before receipt replay and cannot replay another owner’s receipt', async () => {
    const create = request();
    await rpc('create_note', create);
    await admin(
      'update auth.users set email_confirmed_at = null where id = $1',
      [actor],
    );
    await asUser(actor);
    await expect(rpc('create_note', create)).rejects.toThrow(
      'EMAIL_UNVERIFIED',
    );
    await asUser(other);
    await expect(rpc('create_note', create)).rejects.toThrow(
      'NOTE_ALREADY_EXISTS',
    );
    expect(
      (await db.query('select * from public.mutation_receipts')).rows,
    ).toHaveLength(0);
  });

  it('fails closed if the singleton service configuration is absent', async () => {
    const create = request();
    await rpc('create_note', create);
    await admin('delete from public.service_state');
    await asUser(actor);
    try {
      await expect(rpc('create_note', create)).rejects.toThrow(
        'SERVICE_UNAVAILABLE',
      );
      await expect(
        rpc(
          'publish_note',
          request({ note_id: create.note_id, expected_version: '1' }),
        ),
      ).rejects.toThrow('SERVICE_UNAVAILABLE');
      expect(await note(create.note_id)).toBe(null);
    } finally {
      await admin(
        'insert into public.service_state(singleton,dataset_epoch) values (true,$1)',
        [epoch],
      );
    }
  });

  it('keeps versions exact beyond JavaScript’s safe integer range', async () => {
    const create = request();
    await rpc('create_note', create);
    await admin(
      'update public.notes set version = 9007199254740993 where id = $1',
      [create.note_id],
    );
    await asUser(actor);
    const result = await rpc(
      'save_note',
      request({
        note_id: create.note_id,
        expected_version: '9007199254740993',
        body: 'Exact version',
      }),
    );
    expect(result.version).toBe('9007199254740994');
    expect(await note(create.note_id)).toMatchObject({
      version: '9007199254740994',
      body: 'Exact version',
    });
  });
});

describe('folder and literal search contracts', () => {
  function folder(name: string, parent: string | null = null): Json {
    return {
      protocol: 1,
      epoch,
      mutation_id: randomUUID(),
      folder_id: randomUUID(),
      expected_version: null,
      name,
      parent_id: parent,
    };
  }

  it('enforces depth, subtree cycles, same ownership and nonempty deletion', async () => {
    const a = folder('A');
    await rpc('create_folder', a);
    const b = folder('B', String(a.folder_id));
    await rpc('create_folder', b);
    const c = folder('C', String(b.folder_id));
    await rpc('create_folder', c);
    await expect(
      rpc('create_folder', folder('D', String(c.folder_id))),
    ).rejects.toThrow('FOLDER_DEPTH_EXCEEDED');
    await expect(
      rpc('update_folder', {
        ...a,
        mutation_id: randomUUID(),
        expected_version: '1',
        parent_id: c.folder_id,
      }),
    ).rejects.toThrow('FOLDER_CYCLE');
    await expect(
      rpc('delete_folder', {
        ...a,
        mutation_id: randomUUID(),
        expected_version: '1',
      }),
    ).rejects.toThrow('FOLDER_NOT_EMPTY');
    await asUser(other);
    await expect(
      rpc('create_note', request({ folder_id: a.folder_id })),
    ).rejects.toThrow('FOLDER_UNAVAILABLE');
  });

  it('retains trashed note text and restores to root after its empty folder is deleted', async () => {
    const a = folder('A');
    await rpc('create_folder', a);
    const create = request({ folder_id: a.folder_id });
    await rpc('create_note', create);
    await rpc(
      'trash_note',
      request({ note_id: create.note_id, expected_version: '1' }),
    );
    await rpc('delete_folder', {
      ...a,
      mutation_id: randomUUID(),
      expected_version: '1',
    });
    const result = await rpc(
      'restore_note',
      request({ note_id: create.note_id, expected_version: '2' }),
    );
    expect(result.folder_id).toBe(null);
    expect(await note(create.note_id)).toMatchObject({ body: 'Original' });
  });

  it('treats SQL wildcard punctuation literally and returns an independent continuation', async () => {
    for (let index = 0; index < 21; index++)
      await rpc(
        'create_note',
        request({ title: `100% literal ${index}`, body: 'a_b' }),
      );
    await rpc('create_note', request({ title: 'ordinary', body: 'axxb' }));
    const first = await db.query<{ result: Json }>(
      "select public.search_notes('% a_b',0,20) as result",
    );
    expect(first.rows[0].result.results).toHaveLength(20);
    expect(first.rows[0].result.next_offset).toBe(20);
    const second = await db.query<{ result: Json }>(
      "select public.search_notes('% a_b',20,20) as result",
    );
    expect(second.rows[0].result.results).toHaveLength(1);
    expect(second.rows[0].result.next_offset).toBe(null);
  });
});

describe('explicit public snapshots', () => {
  async function publicRead(token: unknown): Promise<Json | null> {
    const result = await db.query<{ result: Json | null }>(
      'select public.read_publication($1) as result',
      [token],
    );
    return result.rows[0].result;
  }

  async function enablePublishing(): Promise<void> {
    await admin('update public.service_state set publications_enabled = true');
    await asUser(actor);
  }

  it('keeps anonymous publishing closed by default', async () => {
    const create = request();
    await rpc('create_note', create);
    await expect(
      rpc(
        'publish_note',
        request({ note_id: create.note_id, expected_version: '1' }),
      ),
    ).rejects.toThrow('PUBLISHING_DISABLED');
    await asUser('', 'anon');
    expect(await publicRead('a'.repeat(64))).toBe(null);
  });

  it('publishes one acknowledged snapshot; private edits remain private until explicit update', async () => {
    const create = request({ body: 'Visible snapshot' });
    await rpc('create_note', create);
    await enablePublishing();
    const publishRequest = request({
      note_id: create.note_id,
      expected_version: '1',
    });
    const publication = await rpc('publish_note', publishRequest);
    expect(publication.token).toMatch(/^[0-9a-f]{64}$/);
    await rpc(
      'save_note',
      request({
        note_id: create.note_id,
        expected_version: '1',
        body: 'Private new draft',
      }),
    );
    expect(await rpc('publish_note', publishRequest)).toEqual(publication);
    await asUser('', 'anon');
    expect(await publicRead(publication.token)).toMatchObject({
      body: 'Visible snapshot',
    });
    await expect(db.query('select * from public.publications')).rejects.toThrow(
      'permission denied',
    );
    await asUser(actor);
    await expect(
      rpc(
        'update_publication',
        request({
          note_id: create.note_id,
          expected_version: '1',
          publication_version: '1',
        }),
      ),
    ).rejects.toThrow('VERSION_CONFLICT');
    await rpc(
      'update_publication',
      request({
        note_id: create.note_id,
        expected_version: '2',
        publication_version: '1',
      }),
    );
    await asUser('', 'anon');
    expect(await publicRead(publication.token)).toMatchObject({
      body: 'Private new draft',
      version: '2',
    });
  });

  it('revokes on unpublish and creates a different token when republished', async () => {
    const create = request();
    await rpc('create_note', create);
    await enablePublishing();
    const first = await rpc(
      'publish_note',
      request({ note_id: create.note_id, expected_version: '1' }),
    );
    await rpc(
      'unpublish_note',
      request({
        note_id: create.note_id,
        expected_version: '1',
        publication_version: '1',
      }),
    );
    expect(await publicRead(first.token)).toBe(null);
    const second = await rpc(
      'publish_note',
      request({ note_id: create.note_id, expected_version: '1' }),
    );
    expect(second.token).not.toBe(first.token);
    expect(await publicRead(first.token)).toBe(null);
    expect(await publicRead(second.token)).toMatchObject({ body: 'Original' });
  });

  it('revokes publication atomically with trash and does not revive it on restore', async () => {
    const create = request();
    await rpc('create_note', create);
    await enablePublishing();
    const publication = await rpc(
      'publish_note',
      request({ note_id: create.note_id, expected_version: '1' }),
    );
    await rpc(
      'trash_note',
      request({ note_id: create.note_id, expected_version: '1' }),
    );
    expect(await publicRead(publication.token)).toBe(null);
    await rpc(
      'restore_note',
      request({ note_id: create.note_id, expected_version: '2' }),
    );
    expect(await publicRead(publication.token)).toBe(null);
  });

  it('blocks public reads for account lifecycle or service maintenance even with a valid token', async () => {
    const create = request();
    await rpc('create_note', create);
    await enablePublishing();
    const publication = await rpc(
      'publish_note',
      request({ note_id: create.note_id, expected_version: '1' }),
    );
    await admin(
      "update public.accounts set status = 'deleting' where user_id = $1",
      [actor],
    );
    await asUser('', 'anon');
    expect(await publicRead(publication.token)).toBe(null);
    await admin(
      "update public.accounts set status = 'active' where user_id = $1",
      [actor],
    );
    await admin('update public.service_state set reads_enabled = false');
    await asUser('', 'anon');
    expect(await publicRead(publication.token)).toBe(null);
  });
});
