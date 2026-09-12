import { describe, expect, it, vi } from 'vitest';
import { handlePublication } from '../../worker/publication';
import { handleRequest } from '../../worker/router';

const config = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_test',
  PUBLICATIONS_ENABLED: 'true',
};
const token = 'a'.repeat(64);
const url = `https://airytype.test/p/${token}.md`;

describe('public Markdown boundary', () => {
  it('returns an explicit snapshot as non-executable Markdown with no cache or indexing', async () => {
    const body = '# Published\n<script>alert("x")</script>\n';
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ body }));
    const response = await handlePublication(
      new Request(url),
      config,
      upstream,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
    expect(response.headers.get('Content-Type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(String(upstream.mock.calls[0]?.[0])).toBe(
      'https://project.supabase.co/rest/v1/rpc/read_publication',
    );
    expect(upstream.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ p_token: token }),
    );
    expect(upstream.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      'Authorization',
    );
  });

  it('checks the same state for HEAD while suppressing the body', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ body: 'snapshot' }));
    const response = await handlePublication(
      new Request(url, { method: 'HEAD' }),
      config,
      upstream,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each(['GET', 'HEAD'])(
    'unknown and revoked tokens are 404 for %s',
    async (method) => {
      const upstream = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(null));
      const response = await handlePublication(
        new Request(url, { method }),
        config,
        upstream,
      );
      expect(response.status).toBe(404);
      if (method === 'HEAD') expect(await response.text()).toBe('');
    },
  );

  it('keeps public content closed independently of the database', async () => {
    const upstream = vi.fn<typeof fetch>();
    const response = await handlePublication(
      new Request(url),
      { ...config, PUBLICATIONS_ENABLED: 'false' },
      upstream,
    );
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods without querying the database', async () => {
    const upstream = vi.fn<typeof fetch>();
    const response = await handlePublication(
      new Request(url, { method: 'POST' }),
      config,
      upstream,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('does not let malformed public routes or private API paths reach the SPA', async () => {
    const assets = { fetch: vi.fn().mockResolvedValue(new Response('SPA')) };
    for (const path of [
      '/p',
      '/p/bad.md',
      '/p/../p/bad.md',
      '/api/delete-account',
    ]) {
      expect(
        (
          await handleRequest(
            new Request(`https://airytype.test${path}`),
            config,
            assets,
          )
        ).status,
      ).toBe(404);
    }
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it('does not turn an upstream error or malformed payload into a public snapshot', async () => {
    for (const response of [
      new Response('private backend detail', { status: 500 }),
      Response.json({ body: 123 }),
    ]) {
      const upstream = vi.fn<typeof fetch>().mockResolvedValue(response);
      const result = await handlePublication(
        new Request(url),
        config,
        upstream,
      );
      expect(result.status).toBe(503);
      expect(await result.text()).not.toContain('private backend detail');
    }
  });

  it('rejects an oversized decoded publication', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ body: 'x'.repeat(1024 * 1024 + 1) }));
    expect(
      (await handlePublication(new Request(url), config, upstream)).status,
    ).toBe(503);
  });
});
