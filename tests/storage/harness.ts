import {
  createLocalRepository,
  type LocalRepository,
} from '../../src/storage/repository';

declare global {
  interface Window {
    storageHarness: LocalRepository;
    storageDurabilityHints: string[];
  }
}

window.storageDurabilityHints = [];
const originalTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function (stores, mode, options) {
  const transaction = originalTransaction.call(this, stores, mode, options);
  if (mode === 'readwrite')
    window.storageDurabilityHints.push(transaction.durability);
  return transaction;
};
window.storageHarness = createLocalRepository({
  databaseName: 'airytype-storage-browser-verification',
});
window.storageHarness
  .initialize()
  .then((snapshot) => {
    document.getElementById('status')!.textContent = snapshot.mode;
  })
  .catch(() => {
    document.getElementById('status')!.textContent = 'storage failed';
  });
