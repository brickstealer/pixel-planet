/**
 * Persistent IndexedDB Cache for OpenStreetMap GeoJSON queries.
 * Allows storing gigabytes of city features locally with 0ms network latency on reload.
 */
export class OsmCache {
  dbName: string;
  storeName: string;
  dbPromise: Promise<IDBDatabase | null>;

  constructor(dbName: string = 'PixelPlanetOsmCache_v4', storeName: string = 'osm_sectors_v4') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.dbPromise = this.initDB();
  }

  private initDB(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('indexedDB' in window)) {
        resolve(null);
        return;
      }
      try {
        const req = window.indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'key' });
          }
        };
        req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
        req.onerror = (e) => {
          console.warn('IndexedDB unavailable, proceeding without cache:', e);
          resolve(null);
        };
      } catch (err) {
        console.warn('IndexedDB init error:', err);
        resolve(null);
      }
    });
  }

  async get<T = any>(key: string): Promise<T | null> {
    const db = await this.dbPromise;
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result && req.result.data) {
            resolve(req.result.data as T);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async set(key: string, data: any): Promise<void> {
    const db = await this.dbPromise;
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.put({
          key: key,
          timestamp: Date.now(),
          data: data
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
