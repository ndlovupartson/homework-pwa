// Minimal promise wrapper around the native IndexedDB API.
// Deliberately dependency-free (no Dexie/idb library) so the app has one
// fewer thing to break, bundle, or go stale — IndexedDB's raw API is
// verbose but small, and this file is the entire cost of avoiding a
// dependency for it.

/**
 * Open (or create/upgrade) an IndexedDB database.
 * @param {string} name
 * @param {number} version
 * @param {(db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void} onUpgrade
 * @returns {Promise<IDBDatabase>}
 */
export function openDb(name, version, onUpgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (event) => {
      onUpgrade(request.result, event.oldVersion, request.transaction);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Database "${name}" upgrade blocked — close other open tabs`));
  });
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/** Insert-or-overwrite a single record by primary key. */
export async function put(db, storeName, value) {
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await promisifyTx(tx);
  return value;
}

/** Insert-or-overwrite many records in one transaction (atomic). */
export async function putAll(db, storeName, values) {
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const value of values) store.put(value);
  await promisifyTx(tx);
  return values;
}

export async function get(db, storeName, key) {
  const tx = db.transaction(storeName, 'readonly');
  const result = await promisifyRequest(tx.objectStore(storeName).get(key));
  return result ?? null;
}

export async function getAll(db, storeName) {
  const tx = db.transaction(storeName, 'readonly');
  return promisifyRequest(tx.objectStore(storeName).getAll());
}

/** Query an index for all records matching a value (e.g. all homework for a classId). */
export async function getAllByIndex(db, storeName, indexName, value) {
  const tx = db.transaction(storeName, 'readonly');
  const index = tx.objectStore(storeName).index(indexName);
  return promisifyRequest(index.getAll(value));
}

export async function remove(db, storeName, key) {
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await promisifyTx(tx);
}

export async function clearStore(db, storeName) {
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await promisifyTx(tx);
}

export function generateId() {
  // crypto.randomUUID() is available in all target browsers (secure context,
  // which a Cloudflare Pages HTTPS deployment always is).
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}
