interface GenerationRecord {
  id: string;
  generation: number;
}

export interface JournalOptions<T extends GenerationRecord> {
  write(record: T): Promise<void>;
  committed(record: T): void;
  failed(record: T, error: unknown): void;
  delayMs?: number;
}

/** One active transaction globally, plus one replaceable snapshot per dirty note. */
export class BoundedJournal<T extends GenerationRecord> {
  private pending = new Map<string, T>();
  private active: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failure: unknown;
  private stopped = false;

  constructor(private options: JournalOptions<T>) {}

  enqueue(record: T): void {
    if (this.stopped) throw new Error('The local journal is closed.');
    this.pending.set(record.id, { ...record });
    this.failure = undefined;
    if (!this.active && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.drain();
      }, this.options.delayMs ?? 100);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
  get writing(): boolean {
    return Boolean(this.active);
  }

  private drain(): Promise<void> {
    if (this.active) return this.active;
    this.active = (async () => {
      while (this.pending.size && !this.stopped) {
        const first = this.pending.entries().next().value as [string, T];
        const [id, record] = first;
        this.pending.delete(id);
        try {
          await this.options.write(record);
          this.options.committed(record);
        } catch (error) {
          // The newer coalesced snapshot is the one that must survive a retry.
          if (!this.pending.has(id)) this.pending.set(id, record);
          this.failure = error;
          this.options.failed(record, error);
          break;
        }
      }
    })().finally(() => {
      this.active = undefined;
      // A subscriber may enqueue between the final write and this microtask.
      if (this.pending.size && !this.failure && !this.stopped && !this.timer) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.drain();
        }, 0);
      }
    });
    return this.active;
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.failure = undefined;
    do {
      await this.drain();
      if (this.failure) throw this.failure;
    } while (this.pending.size);
  }

  async close(): Promise<void> {
    await this.flush();
    this.stopped = true;
  }
}
