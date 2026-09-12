import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import type {
  ManifestNote,
  MutationAcknowledgement,
} from '../../src/sync/protocol';

const accountId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const email = 'writer@example.test';
const epoch = '33333333-3333-4333-8333-333333333333';
const timestamp = '2026-09-12T10:00:00.000Z';

interface WriteRequest {
  protocol: number;
  epoch: string;
  mutation_id: string;
  note_id: string;
  expected_version: string | null;
  title: string;
  body: string;
  folder_id: string | null;
}

interface CloudNote extends ManifestNote {
  body: string;
  epoch: string;
}

function token(): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: accountId,
    session_id: sessionId,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.${Buffer.from('synthetic-test-signature').toString('base64url')}`;
}

/** Network substitute only: the app, Auth SDK, repositories and coordinator are real. */
async function mockCloud(page: Page) {
  const notes = new Map<string, CloudNote>();
  const receipts = new Map<string, MutationAcknowledgement>();
  const writes: WriteRequest[] = [];
  const bodyReads: string[] = [];
  const unexpected: string[] = [];
  const logoutScopes: (string | null)[] = [];
  let logoutCalls = 0;
  let heldWrite: {
    arrived: (write: WriteRequest) => void;
    released: Promise<void>;
  } | null = null;
  const user = {
    id: accountId,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    email_confirmed_at: timestamp,
    confirmed_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
  };
  async function reply(route: Route, body: unknown, status = 200) {
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  }
  await page.route('https://airytype-staging.test/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'access-control-allow-headers': '*',
        },
      });
      return;
    }
    if (url.pathname === '/auth/v1/token') {
      await reply(route, {
        access_token: token(),
        token_type: 'bearer',
        refresh_token: 'synthetic-refresh-token',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
      });
      return;
    }
    if (url.pathname === '/auth/v1/user') {
      await reply(route, user);
      return;
    }
    if (url.pathname === '/auth/v1/logout') {
      logoutCalls += 1;
      logoutScopes.push(url.searchParams.get('scope'));
      await reply(route, {});
      return;
    }
    if (url.pathname === '/rest/v1/rpc/get_service_state') {
      await reply(route, {
        epoch,
        minimum_protocol: 1,
        reads_enabled: true,
        writes_enabled: true,
      });
      return;
    }
    if (url.pathname === '/rest/v1/rpc/list_manifest') {
      const manifestNotes = [...notes.values()].map((note) => {
        const { body: _body, epoch: _epoch, ...metadata } = note;
        void _body;
        void _epoch;
        return metadata;
      });
      await reply(route, {
        epoch,
        notes: manifestNotes,
        folders: [],
        counts: {
          normal_active: notes.size,
          normal_retained: notes.size,
          recovery_retained: 0,
          note_tombstones: 0,
          folder_active: 0,
          folder_tombstones: 0,
        },
      });
      return;
    }
    if (url.pathname === '/rest/v1/rpc/get_note') {
      const { p_note_id: id } = request.postDataJSON() as { p_note_id: string };
      bodyReads.push(id);
      await reply(route, notes.get(id) ?? null);
      return;
    }
    if (
      ['/rest/v1/rpc/create_note', '/rest/v1/rpc/save_note'].includes(
        url.pathname,
      )
    ) {
      const { p_request: write } = request.postDataJSON() as {
        p_request: WriteRequest;
      };
      writes.push(write);
      expect(request.headers().authorization).toMatch(/^Bearer /);
      expect(write.epoch).toBe(epoch);
      let acknowledgement = receipts.get(write.mutation_id);
      if (!acknowledgement) {
        const prior = notes.get(write.note_id);
        expect(write.expected_version).toBe(prior?.version ?? null);
        const note: CloudNote = {
          id: write.note_id,
          title: write.title,
          body: write.body,
          body_bytes: Buffer.byteLength(write.body, 'utf8'),
          folder_id: write.folder_id,
          version: String(BigInt(prior?.version ?? '0') + 1n),
          kind: 'normal',
          epoch,
          deleted_at: null,
          purged_at: null,
          created_at: prior?.created_at ?? timestamp,
          updated_at: timestamp,
        };
        notes.set(note.id, note);
        acknowledgement = {
          epoch,
          note_id: note.id,
          mutation_id: write.mutation_id,
          version: note.version,
          title: note.title,
          folder_id: note.folder_id,
          deleted_at: null,
          kind: 'normal',
        };
        receipts.set(write.mutation_id, acknowledgement);
      }
      const held = heldWrite;
      heldWrite = null;
      if (held) {
        held.arrived(write);
        await held.released;
      }
      await reply(route, acknowledgement);
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await reply(route, { message: 'Unexpected mocked request' }, 500);
  });
  return {
    notes,
    writes,
    bodyReads,
    unexpected,
    logoutScopes,
    get logoutCalls() {
      return logoutCalls;
    },
    holdNextWrite() {
      let arrived!: (write: WriteRequest) => void;
      let release!: () => void;
      const arrival = new Promise<WriteRequest>((resolve) => {
        arrived = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      heldWrite = { arrived, released };
      return { arrival, release };
    },
  };
}

async function openLocal(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'A little space for your thoughts',
  );
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible();
}

async function signIn(page: Page) {
  await page.locator('.profile').click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your account notebook', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
}

async function createAccountNote(page: Page, body: string) {
  await page
    .getByRole('button', { name: 'New note', exact: true })
    .first()
    .click();
  await page.getByRole('textbox', { name: 'Note title' }).fill('Account draft');
  await page.getByRole('textbox', { name: 'Note content' }).fill(body);
}

async function cloudAcknowledged(page: Page) {
  await expect(
    page.getByRole('button', {
      name: 'Saved on this device · Cloud save acknowledged',
      exact: true,
    }),
  ).toBeVisible({ timeout: 15_000 });
}

test('local drafts stay separate; account create, acknowledge, reload and remote body refresh use the actual notebook', async ({
  page,
}, testInfo) => {
  const cloud = await mockCloud(page);
  await openLocal(page);
  await page
    .getByRole('textbox', { name: 'Note title' })
    .fill('Only on this device');
  await page
    .getByRole('textbox', { name: 'Note content' })
    .fill('LOCAL-ONLY sentinel 🌿');
  await signIn(page);
  await expect(page.locator('.note-card')).toHaveCount(0);
  expect(cloud.writes).toEqual([]);
  await createAccountNote(page, 'Account text with exact 🌱 Unicode.');
  await cloudAcknowledged(page);
  expect(cloud.notes.size).toBe(1);
  expect(
    cloud.writes.every((write) => !write.body.includes('LOCAL-ONLY')),
  ).toBe(true);
  await expect(
    page.getByRole('button', { name: 'New folder', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Import Markdown', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Note actions' }).click();
  await expect(
    page.getByRole('button', { name: 'Move to folder', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Move to Trash', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Note actions' }).click();

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Only on this device',
  );
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    'LOCAL-ONLY sentinel 🌿',
  );
  const remote = [...cloud.notes.values()][0];
  const refreshed = 'A coherent newer cloud body, fetched after reload 🌱.';
  cloud.notes.set(remote.id, {
    ...remote,
    body: refreshed,
    body_bytes: Buffer.byteLength(refreshed, 'utf8'),
    version: String(BigInt(remote.version) + 1n),
  });
  const writesBeforeOpen = cloud.writes.length;
  await page.locator('.profile').click();
  await page
    .getByRole('button', { name: 'Open account notebook', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your account notebook', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('account-notebook-dialog.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    refreshed,
  );
  expect(cloud.bodyReads).toContain(remote.id);
  expect(cloud.writes).toHaveLength(writesBeforeOpen);
  await page.locator('.profile').click();
  await page
    .getByRole('button', { name: 'Open local notebook', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your local notebook', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    'LOCAL-ONLY sentinel 🌿',
  );
  expect(cloud.unexpected).toEqual([]);
});

test('cancelling logout while a cloud reply is delayed preserves newer typing and avoids SDK logout', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await openLocal(page);
  await signIn(page);
  const held = cloud.holdNextWrite();
  await createAccountNote(page, 'First generation sent to cloud.');
  const sent = await held.arrival;
  expect(sent.body).toBe('First generation sent to cloud.');
  const latest = 'Latest typing survives the delayed acknowledgement 🌱.';
  await page.getByRole('textbox', { name: 'Note content' }).fill(latest);
  await page.locator('.profile').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Wait for uploads', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Wait for uploads', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Cloud saves are still pending',
  );
  await page
    .getByRole('button', { name: 'Cancel sign out', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your account notebook', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    latest,
  );
  held.release();
  await expect
    .poll(() => cloud.notes.get(sent.note_id)?.body, { timeout: 15_000 })
    .toBe(latest);
  await cloudAcknowledged(page);
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    latest,
  );
  expect(cloud.logoutCalls).toBe(0);
  expect(cloud.unexpected).toEqual([]);
});

test('session loss hides account text, permits draft export and restores only after same-account sign-in', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await openLocal(page);
  await signIn(page);
  const body = 'PRIVATE ACCOUNT BODY — preserved through session loss 🌱.';
  await createAccountNote(page, body);
  await cloudAcknowledged(page);
  await page.evaluate(async () => {
    // Fixture-only access to the real SDK; no production-only test hook is added.
    const modulePath = '/src/auth/client.ts';
    const { supabase } = await import(modulePath);
    await supabase.auth.signOut({ scope: 'local' });
  });
  await expect(
    page.getByRole('heading', { name: 'Your account notebook is paused' }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveCount(
    0,
  );
  await expect(page.locator('body')).not.toContainText(body);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email);
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  const downloadEvent = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export notebook', exact: true })
    .click();
  const download = await downloadEvent;
  const files = unzipSync(await readFile((await download.path())!));
  expect(
    Object.entries(files).some(
      ([name, bytes]) => name.endsWith('.md') && strFromU8(bytes) === body,
    ),
  ).toBe(true);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await page
    .getByRole('button', { name: 'Sign in again', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    body,
  );
  await expect(page.getByRole('textbox', { name: 'Note title' })).toBeEnabled();
  expect(cloud.unexpected).toEqual([]);
});

test('a reader requests logout in the writing tab; cancel retains the session and completion signs out only this device', async ({
  page,
  context,
}) => {
  const cloud = await mockCloud(page);
  await openLocal(page);
  const localBody = 'Local words retained after account sign-out 🌿.';
  await page.getByRole('textbox', { name: 'Note content' }).fill(localBody);
  await signIn(page);
  const accountBody = 'Acknowledged account words remain separate 🌱.';
  await createAccountNote(page, accountBody);
  await cloudAcknowledged(page);
  const reader = await context.newPage();
  const readerCloud = await mockCloud(reader);
  await reader.goto('/');
  await expect(reader.getByText(/This tab is read-only/)).toBeVisible();
  await expect(
    reader.getByRole('textbox', { name: 'Note content' }),
  ).toHaveText(localBody);
  await reader.locator('.profile').click();
  await expect(
    reader.getByRole('button', { name: 'Open account notebook', exact: true }),
  ).toBeDisabled();
  await reader
    .getByRole('button', { name: 'Request sign out', exact: true })
    .click();
  await expect(reader.getByRole('dialog').getByRole('status')).toContainText(
    'Logout was requested in the writing tab',
  );
  await expect(
    page.getByRole('heading', {
      name: 'Finish saving before signing out',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Cancel sign out', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    accountBody,
  );
  expect(cloud.logoutCalls).toBe(0);
  await expect(
    reader.getByRole('button', { name: 'Request sign out', exact: true }),
  ).toBeEnabled();
  await reader
    .getByRole('button', { name: 'Request sign out', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Finish saving before signing out',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveText(
    localBody,
  );
  await expect(
    reader.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByRole('button', { name: 'Request sign out', exact: true }),
  ).toHaveCount(0);
  await expect(reader.getByLabel('Email', { exact: true })).toHaveValue('');
  await reader
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(
    reader.getByRole('textbox', { name: 'Note content' }),
  ).toHaveText(localBody);
  await page.locator('.profile').click();
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  expect(cloud.logoutScopes).toEqual(['local']);
  expect(readerCloud.logoutCalls).toBe(0);
  expect(cloud.unexpected).toEqual([]);
  expect(readerCloud.unexpected).toEqual([]);
});

test('failed local saving keeps exact memory export and unload protection after session loss unmounts the notebook', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await openLocal(page);
  await signIn(page);
  const acknowledged = 'The last acknowledged account body.';
  await createAccountNote(page, acknowledged);
  await cloudAcknowledged(page);
  await page.evaluate(async () => {
    // Use the module the app loaded, including Vite's development version query.
    const modulePath = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .findLast((name) => new URL(name).pathname === '/src/app/notebook.ts');
    if (!modulePath) throw new Error('The notebook module was not loaded.');
    const { notebookSession } = await import(modulePath);
    const intents = notebookSession.getSnapshot().repository.database.intents;
    const original = intents.put;
    intents.put = () => Promise.reject(new Error('Synthetic journal failure'));
    (
      window as Window & { restoreJournalForTest?: () => void }
    ).restoreJournalForTest = () => {
      intents.put = original;
    };
  });
  try {
    const unsaved =
      '  # Unsaved memory 🌱\n\nThis survives session loss without a local transaction.  \n';
    await page.getByRole('textbox', { name: 'Note content' }).fill(unsaved);
    await expect(
      page.getByRole('button', {
        name: 'Couldn’t save on this device',
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const modulePath = '/src/auth/client.ts';
      const { supabase } = await import(modulePath);
      await supabase.auth.signOut({ scope: 'local' });
    });
    await expect(
      page.getByRole('heading', { name: 'Your account notebook is paused' }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Note content' }),
    ).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(
      'This survives session loss',
    );
    expect(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        const dispatched = window.dispatchEvent(event);
        return { prevented: event.defaultPrevented, dispatched };
      }),
    ).toEqual({ prevented: true, dispatched: false });
    const downloadEvent = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export notebook', exact: true })
      .click();
    const download = await downloadEvent;
    const files = unzipSync(await readFile((await download.path())!));
    expect(
      Object.entries(files).some(
        ([name, bytes]) => name.endsWith('.md') && strFromU8(bytes) === unsaved,
      ),
    ).toBe(true);
    expect([...cloud.notes.values()][0].body).toBe(acknowledged);
    expect(cloud.unexpected).toEqual([]);
  } finally {
    await page.evaluate(() => {
      const fixture = window as Window & { restoreJournalForTest?: () => void };
      fixture.restoreJournalForTest?.();
      delete fixture.restoreJournalForTest;
    });
  }
});
