const DB_NAME = 'warehouse-app-offline';
const DB_VERSION = 2;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) {
        db.createObjectStore('entries', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('datasets')) {
        const datasets = db.createObjectStore('datasets', { keyPath: 'key' });
        datasets.createIndex('name', 'name', { unique: false });
        datasets.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
  });
  return dbPromise;
}

function withStore(storeName, mode, fn) {
  return openDb().then(
    (db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try {
        result = fn(store);
      } catch (e) {
        reject(e);
        return;
      }
      if (result instanceof IDBRequest) {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      } else {
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
      }
    }),
  );
}

export function idbGet(storeName, key) {
  return withStore(storeName, 'readonly', (store) => store.get(key));
}

export function idbPut(storeName, value) {
  return withStore(storeName, 'readwrite', (store) => store.put(value));
}

export function idbDelete(storeName, key) {
  return withStore(storeName, 'readwrite', (store) => store.delete(key));
}

export async function idbGetAllKeys(storeName) {
  return withStore(storeName, 'readonly', (store) => store.getAllKeys());
}

export function idbGetAll(storeName) {
  return withStore(storeName, 'readonly', (store) => store.getAll());
}
