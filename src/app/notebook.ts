import { createLocalRepository } from '../storage/repository';
import { starterNotes } from './starter';

// Keep the origin-wide writer independent of React renders and shell hot updates.
export const repository = createLocalRepository();

let initialization: Promise<void> | undefined;
export function initializeNotebook(readOnlyDevice: boolean): Promise<void> {
  initialization ??= (async () => {
    await repository.initialize();
    const current = repository.getSnapshot();
    if (
      current.mode === 'writer' &&
      current.notes.length === 0 &&
      !readOnlyDevice
    ) {
      for (const sample of [...starterNotes].reverse())
        await repository.createNote(sample);
    }
  })();
  return initialization;
}
