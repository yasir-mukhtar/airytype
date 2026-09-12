import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OriginWriterLease,
  WRITER_LOCK_NAME,
} from '../../src/storage/writer-lock';

afterEach(() => vi.unstubAllGlobals());

describe('origin writer ownership', () => {
  it('uses one constant lock across accounts and never steals a live writer', async () => {
    let held = false;
    const request = vi.fn(
      async (
        name: string,
        options: { ifAvailable: boolean },
        callback: (lock: object | null) => Promise<void>,
      ) => {
        expect(name).toBe('airytype:writer');
        expect(options).toEqual({ mode: 'exclusive', ifAvailable: true });
        if (held) return callback(null);
        held = true;
        try {
          return await callback({ name });
        } finally {
          held = false;
        }
      },
    );
    vi.stubGlobal('navigator', { locks: { request } });
    const first = new OriginWriterLease();
    const second = new OriginWriterLease();
    expect(await first.acquire()).toBe('writer');
    expect(await second.acquire()).toBe('readonly');
    expect(held).toBe(true);
    await first.release();
    await second.release();
    expect(await second.acquire()).toBe('writer');
    await second.release();
    expect(WRITER_LOCK_NAME).toBe('airytype:writer');
  });

  it('does not silently enable writing when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {});
    expect(await new OriginWriterLease().acquire()).toBe('unsupported');
  });
});
