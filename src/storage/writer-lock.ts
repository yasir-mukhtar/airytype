import type { WriterMode } from './types';

export const WRITER_LOCK_NAME = 'airytype:writer';

export interface WriterLease {
  acquire(): Promise<WriterMode>;
  release(): Promise<void>;
}

/** This name deliberately does not contain an account or database identifier. */
export class OriginWriterLease implements WriterLease {
  private releaseHold: (() => void) | undefined;
  private request: Promise<unknown> | undefined;
  private mode: WriterMode | undefined;

  async acquire(): Promise<WriterMode> {
    if (this.mode) return this.mode;
    if (typeof navigator === 'undefined' || !navigator.locks) {
      this.mode = 'unsupported';
      return this.mode;
    }
    const acquired = new Promise<WriterMode>((resolve) => {
      this.request = navigator.locks
        .request(
          WRITER_LOCK_NAME,
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            if (!lock) {
              this.mode = 'readonly';
              resolve(this.mode);
              return;
            }
            const held = new Promise<void>((release) => {
              this.releaseHold = release;
            });
            this.mode = 'writer';
            resolve(this.mode);
            await held;
          },
        )
        .catch(() => {
          this.mode = 'unsupported';
          resolve(this.mode);
        });
    });
    return acquired;
  }

  async release(): Promise<void> {
    this.releaseHold?.();
    await this.request;
    this.mode = undefined;
    this.releaseHold = undefined;
  }
}
