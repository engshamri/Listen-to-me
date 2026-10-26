/*
 * A small promise wrapper over IndexedDB, shared by the library and the study
 * workspace. No dependency; works with fake-indexeddb in unit tests.
 */

export type IdbErrorCode = "UNAVAILABLE" | "QUOTA" | "NOT_FOUND" | "FAILED";

export class IdbError extends Error {
  constructor(readonly code: IdbErrorCode) {
    super(code);
  }
}

export function toIdbError(e: unknown): IdbError {
  if (e instanceof IdbError) return e;
  const name = (e as { name?: string } | null)?.name;
  return new IdbError(name === "QuotaExceededError" ? "QUOTA" : "FAILED");
}

export interface Database {
  /** Runs `fn` in one transaction and resolves with its result once the transaction has committed. */
  transact<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => T | Promise<T>): Promise<T>;
  /** For tests: forget the open connection (e.g. after replacing the IndexedDB factory). */
  reset(): void;
}

/** Opens `name` lazily on first use; `upgrade` creates or migrates stores. */
export function database(name: string, version: number, upgrade: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void): Database {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        if (typeof indexedDB === "undefined") throw new IdbError("UNAVAILABLE");
        req = indexedDB.open(name, version);
      } catch (e) {
        reject(e instanceof IdbError ? e : new IdbError("UNAVAILABLE"));
        return;
      }
      req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion, req.transaction!);
      req.onsuccess = () => {
        const db = req.result;
        // Another tab is upgrading the database: step aside and reopen on next use.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(new IdbError("UNAVAILABLE"));
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
    return dbPromise;
  }

  return {
    async transact(stores, mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        let result: Awaited<ReturnType<typeof fn>>;
        let tx: IDBTransaction;
        try {
          tx = db.transaction(stores, mode);
        } catch (e) {
          reject(toIdbError(e));
          return;
        }
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(toIdbError(tx.error));
        Promise.resolve(fn(tx)).then(
          (r) => {
            result = r;
          },
          (e) => {
            try {
              tx.abort();
            } catch {
              // Already finished.
            }
            reject(toIdbError(e));
          },
        );
      });
    },
    reset() {
      dbPromise = null;
    },
  };
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Change notifications for one database, in this tab and (via BroadcastChannel) in others. */
export function changeChannel(name: string) {
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | null = null;
  return {
    notify() {
      listeners.forEach((l) => l());
      try {
        channel?.postMessage("changed");
      } catch {
        // Channel closed.
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (!channel && typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(name);
        channel.onmessage = () => listeners.forEach((l) => l());
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && channel) {
          channel.close();
          channel = null;
        }
      };
    },
  };
}
