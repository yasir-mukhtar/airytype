import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundedJournal } from '../../src/storage/journal';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe('bounded local journal', () => {
  it('coalesces continuous typing behind one slow write and acknowledges exact generations', async () => {
    vi.useFakeTimers();
    const firstWrite = deferred();
    const started: number[] = [];
    const committed: number[] = [];
    const journal = new BoundedJournal({
      write: async (record: {
        id: string;
        generation: number;
        body: string;
      }) => {
        started.push(record.generation);
        if (record.generation === 1) await firstWrite.promise;
      },
      committed: (record) => {
        committed.push(record.generation);
      },
      failed: () => {},
    });
    journal.enqueue({ id: 'note', generation: 1, body: 'sentinel-1' });
    await vi.advanceTimersByTimeAsync(100);
    for (let generation = 2; generation <= 500; generation += 1) {
      journal.enqueue({
        id: 'note',
        generation,
        body: `sentinel-${generation}`,
      });
    }
    expect(started).toEqual([1]);
    expect(committed).toEqual([]);
    expect(journal.pendingCount).toBe(1);
    expect(journal.writing).toBe(true);
    firstWrite.resolve();
    await journal.flush();
    expect(started).toEqual([1, 500]);
    expect(committed).toEqual([1, 500]);
    expect(journal.pendingCount).toBe(0);
  });

  it('gives other dirty notes a turn while the active note keeps changing', async () => {
    const wait = deferred();
    const started: string[] = [];
    const journal = new BoundedJournal({
      write: async (record: { id: string; generation: number }) => {
        started.push(`${record.id}:${record.generation}`);
        if (started.length === 1) await wait.promise;
      },
      committed: () => {},
      failed: () => {},
    });
    journal.enqueue({ id: 'a', generation: 1 });
    const flushed = journal.flush();
    journal.enqueue({ id: 'b', generation: 1 });
    journal.enqueue({ id: 'a', generation: 2 });
    journal.enqueue({ id: 'a', generation: 3 });
    wait.resolve();
    await flushed;
    expect(started).toEqual(['a:1', 'b:1', 'a:3']);
  });

  it('retains the latest coalesced text when storage fails and allows deliberate retry', async () => {
    const fail = vi
      .fn()
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValue(undefined);
    const saved: number[] = [];
    const journal = new BoundedJournal({
      write: fail,
      committed: (record: { id: string; generation: number }) => {
        saved.push(record.generation);
      },
      failed: () => {},
    });
    journal.enqueue({ id: 'a', generation: 1 });
    await expect(journal.flush()).rejects.toThrow('quota');
    expect(saved).toEqual([]);
    expect(journal.pendingCount).toBe(1);
    journal.enqueue({ id: 'a', generation: 2 });
    await journal.flush();
    expect(saved).toEqual([2]);
  });
});
