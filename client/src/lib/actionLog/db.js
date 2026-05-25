const DB_NAME = 'warehouse-app-actions';
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
      if (!db.objectStoreNames.contains('actions')) {
        const actions = db.createObjectStore('actions', { keyPath: 'clientId' });
        actions.createIndex('createdAt', 'createdAt', { unique: false });
        actions.createIndex('synced', 'synced', { unique: false });
      }
      if (!db.objectStoreNames.contains('mutations')) {
        const mut = db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
        mut.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('refs')) {
        db.createObjectStore('refs', { keyPath: 'key' });
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

export function idbGetAll(storeName) {
  return withStore(storeName, 'readonly', (store) => store.getAll());
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
