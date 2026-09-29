import { describe, expect, it, vi } from 'vitest';
import {
  handlePublishCreate,
  handlePublishedDelete,
  handlePublishedRead,
} from '../../worker/published';
import { handleRequest } from '../../worker/router';

const kv = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => void store.set(key, value),
    delete: async (key: string) => void store.delete(key),
  };
};

const config = (overrides = {}) => ({
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  PUBLICATIONS_ENABLED: 'true',
  PUBLICATIONS: kv(),
  ...overrides,
});

const snapshot = {
  t: 'A little space',
  b: '# A little space\n\nSome *formatted* words.\n',
  u: 1_759_000_000_000,
};

const post = (body: unknown) =>
  new Request('https://airytype.test/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('KV publication API', () => {
  it('stores a snapshot and serves it back under a short token', async () => {
    const env = config();
    const created = await handlePublishCreate(post(snapshot), env);
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const read = await handlePublishedRead(
      new Request(`https://airytype.test/api/publication/${token}`),
      env,
    );
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(snapshot);
    expect(read.headers.get('Cache-Control')).toBe('no-store');
    expect(read.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(read.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('serves HEAD without a body', async () => {
    const env = config();
    const { token } = (await (
      await handlePublishCreate(post(snapshot), env)
    ).json()) as { token: string };
    const read = await handlePublishedRead(
      new Request(`https://airytype.test/api/publication/${token}`, {
        method: 'HEAD',
      }),
      env,
    );
    expect(read.status).toBe(200);
    expect(await read.text()).toBe('');
  });

  it('rejects malformed bodies, methods, and tokens', async () => {
    const env = config();
    for (const request of [
      post('not json {'),
      post(null),
      post({ t: 'x' }),
      post({ t: 'x', b: 42 }),
      post({ t: 'x', b: 'y', u: 'soon' }),
      post({ t: 'x'.repeat(201), b: 'y' }),
    ])
      expect((await handlePublishCreate(request, env)).status).toBe(400);
    expect(env.PUBLICATIONS.store.size).toBe(0);
    expect(
      (await handlePublishCreate(new Request('https://x.test/api/publish'), env))
        .status,
    ).toBe(405);
    for (const path of [
      '/api/publication/short',
      '/api/publication/' + 'z'.repeat(32),
      '/api/publication/' + 'a'.repeat(33),
      '/api/publication/' + 'a'.repeat(32) + '/extra',
    ])
      expect(
        (
          await handlePublishedRead(
            new Request(`https://airytype.test${path}`),
            env,
          )
        ).status,
      ).toBe(404);
    expect(
      (
        await handlePublishedRead(
          new Request(
            'https://airytype.test/api/publication/' + 'a'.repeat(32),
            { method: 'PUT' },
          ),
          env,
        )
      ).status,
    ).toBe(405);
  });

  it('rejects oversized requests without storing', async () => {
    const env = config();
    const request = new Request('https://airytype.test/api/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(1_500_000),
      },
      body: '{}',
    });
    expect((await handlePublishCreate(request, env)).status).toBe(413);
    const oversizedBody = { t: '', b: 'x'.repeat(1024 * 1024 + 1) };
    expect((await handlePublishCreate(post(oversizedBody), env)).status).toBe(
      413,
    );
    expect(env.PUBLICATIONS.store.size).toBe(0);
  });

  it('returns 404 for unknown tokens', async () => {
    const env = config();
    const read = await handlePublishedRead(
      new Request(
        'https://airytype.test/api/publication/' + 'f'.repeat(32),
      ),
      env,
    );
    expect(read.status).toBe(404);
  });

  it('rate-limits publish requests per client', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const env = config({ PUBLISH_RATE: limiter });
    const request = post(snapshot);
    request.headers.set('cf-connecting-ip', '198.51.100.7');
    expect((await handlePublishCreate(request, env)).status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: '198.51.100.7' });
    expect(env.PUBLICATIONS.store.size).toBe(0);
  });

  it('revokes a publication and unknown deletes are still 204', async () => {
    const env = config();
    const { token } = (await (
      await handlePublishCreate(post(snapshot), env)
    ).json()) as { token: string };
    const url = `https://airytype.test/api/publication/${token}`;
    expect(
      (await handlePublishedDelete(new Request(url, { method: 'DELETE' }), env))
        .status,
    ).toBe(204);
    expect(
      (await handlePublishedRead(new Request(url), env)).status,
    ).toBe(404);
    expect(
      (
        await handlePublishedDelete(
          new Request(url.replace(/.$/, '0'), { method: 'DELETE' }),
          env,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await handlePublishedDelete(
          new Request(url.replace(/.$/, '0').slice(0, -1), {
            method: 'DELETE',
          }),
          env,
        )
      ).status,
    ).toBe(404);
  });

  it('stays closed without the flag or store', async () => {
    const off = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', PUBLICATIONS_ENABLED: 'false' };
    expect((await handlePublishCreate(post(snapshot), off)).status).toBe(404);
    const noStore = {
      ...off,
      PUBLICATIONS_ENABLED: 'true',
    };
    expect((await handlePublishCreate(post(snapshot), noStore)).status).toBe(
      404,
    );
  });

  it('routes the API namespace without reaching assets', async () => {
    const env = config();
    const assets = { fetch: vi.fn().mockResolvedValue(new Response('SPA')) };
    const created = await handleRequest(post(snapshot), env, assets);
    expect(created.status).toBe(201);
    expect(assets.fetch).not.toHaveBeenCalled();
    const { token } = (await created.json()) as { token: string };
    const read = await handleRequest(
      new Request(`https://airytype.test/api/publication/${token}`),
      env,
      assets,
    );
    expect(read.status).toBe(200);
    const removed = await handleRequest(
      new Request(`https://airytype.test/api/publication/${token}`, {
        method: 'DELETE',
      }),
      env,
      assets,
    );
    expect(removed.status).toBe(204);
    expect(assets.fetch).not.toHaveBeenCalled();
  });
});
