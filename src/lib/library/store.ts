import type { Timeline } from "@/lib/tts/timeline";

/*
 * Personal library: recordings saved in this browser (IndexedDB), never uploaded.
 * Three object stores keyed by the item id, so the list loads without the
 * (possibly large) text and audio:
 *   items   – metadata, position and bookmarks
 *   content – the read-along timeline (text, sentence and word times)
 *   audio   – the MP3 blob
 */

export interface Bookmark {
  id: string;
  /** Seconds into the recording. */
  time: number;
  /** Start of the bookmarked sentence in the timeline text. */
  from: number;
  /** The sentence, for lists and exports. */
  excerpt: string;
  note: string;
  createdAt: number;
}

export interface LibraryItem {
  id: string;
  title: string;
  /** First characters of the text, for search and the list. */
  excerpt: string;
  createdAt: number;
  voiceId: string;
  speed: number;
  pitch: number;
  duration: number;
  size: number;
  partsDone: number;
  partsTotal: number;
  backupParts: number[];
  /** Where the listener stopped, in seconds. */
  position: number;
  lastPlayedAt: number | null;
  bookmarks: Bookmark[];
}

export interface Recording {
  item: LibraryItem;
  timeline: Timeline;
  audio: Blob;
}

export type NewRecording = Omit<LibraryItem, "id" | "title" | "excerpt" | "createdAt" | "position" | "lastPlayedAt" | "bookmarks"> & {
  timeline: Timeline;
  audio: Blob;
};

export type LibraryErrorCode = "UNAVAILABLE" | "QUOTA" | "NOT_FOUND" | "FAILED";

export class LibraryError extends Error {
  constructor(readonly code: LibraryErrorCode) {
    super(code);
  }
}

const DB_NAME = "asmani-library";
const DB_VERSION = 1;
const CHANNEL = "asmani-library";
const TITLE_MAX = 80;

/** A title from the first line of the text, cut at a word near 80 characters. */
export function titleFrom(text: string): string {
  const line = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:،؛-]+$/u, "")}…`;
}

/** The start of the text after its title line (or of the whole text when it is one line), spaces tidied. */
export function excerptFrom(text: string, max = 300): string {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.trim());
  const rest = lines.slice(first + 1).join(" ").replace(/\s+/g, " ").trim();
  return (rest || text.replace(/\s+/g, " ").trim()).slice(0, max);
}

/** Most recently listened or saved first. */
export function sortItems(items: LibraryItem[]): LibraryItem[] {
  return items.slice().sort((a, b) => Math.max(b.createdAt, b.lastPlayedAt ?? 0) - Math.max(a.createdAt, a.lastPlayedAt ?? 0));
}

function toError(e: unknown): LibraryError {
  if (e instanceof LibraryError) return e;
  const name = (e as { name?: string } | null)?.name;
  return new LibraryError(name === "QuotaExceededError" ? "QUOTA" : "FAILED");
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === "undefined") throw new LibraryError("UNAVAILABLE");
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e instanceof LibraryError ? e : new LibraryError("UNAVAILABLE"));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["items", "content", "audio"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab is upgrading the database: step aside and reopen on next use.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(new LibraryError("UNAVAILABLE"));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** Runs `fn` in one transaction and resolves with its result once the transaction has committed. */
async function transact<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => T | Promise<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (e) {
      reject(toError(e));
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(toError(tx.error));
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
        reject(toError(e));
      },
    );
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Change notifications, in this tab and others.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function notify() {
  listeners.forEach((l) => l());
  try {
    channel?.postMessage("changed");
  } catch {
    // Channel closed.
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => listeners.forEach((l) => l());
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && channel) {
      channel.close();
      channel = null;
    }
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function listItems(): Promise<LibraryItem[]> {
  const items = await transact(["items"], "readonly", (tx) => request(tx.objectStore("items").getAll() as IDBRequest<LibraryItem[]>));
  return sortItems(items);
}

export async function getItem(id: string): Promise<LibraryItem | null> {
  const item = await transact(["items"], "readonly", (tx) => request(tx.objectStore("items").get(id) as IDBRequest<LibraryItem | undefined>));
  return item ?? null;
}

export async function loadRecording(id: string): Promise<Recording> {
  const [item, timeline, audio] = await transact(["items", "content", "audio"], "readonly", (tx) =>
    Promise.all([
      request(tx.objectStore("items").get(id) as IDBRequest<LibraryItem | undefined>),
      request(tx.objectStore("content").get(id) as IDBRequest<Timeline | undefined>),
      request(tx.objectStore("audio").get(id) as IDBRequest<Blob | undefined>),
    ]),
  );
  if (!item || !timeline || !audio) throw new LibraryError("NOT_FOUND");
  return { item, timeline, audio };
}

export async function saveRecording({ timeline, audio, ...meta }: NewRecording): Promise<LibraryItem> {
  const item: LibraryItem = {
    ...meta,
    id: crypto.randomUUID(),
    title: titleFrom(timeline.text) || "—",
    excerpt: excerptFrom(timeline.text),
    createdAt: Date.now(),
    position: 0,
    lastPlayedAt: null,
    bookmarks: [],
  };
  await transact(["items", "content", "audio"], "readwrite", (tx) => {
    tx.objectStore("items").put(item, item.id);
    tx.objectStore("content").put(timeline, item.id);
    tx.objectStore("audio").put(audio, item.id);
  });
  notify();
  return item;
}

export type ItemPatch = Partial<Pick<LibraryItem, "title" | "position" | "lastPlayedAt" | "bookmarks">>;

/** Changes an item in one read-modify-write transaction; returns the updated item. */
export async function updateItem(id: string, patch: ItemPatch | ((item: LibraryItem) => ItemPatch)): Promise<LibraryItem> {
  const updated = await transact(["items"], "readwrite", async (tx) => {
    const store = tx.objectStore("items");
    const item = (await request(store.get(id) as IDBRequest<LibraryItem | undefined>)) ?? null;
    if (!item) throw new LibraryError("NOT_FOUND");
    const next = { ...item, ...(typeof patch === "function" ? patch(item) : patch) };
    store.put(next, id);
    return next;
  });
  notify();
  return updated;
}

export async function deleteItem(id: string): Promise<void> {
  await transact(["items", "content", "audio"], "readwrite", (tx) => {
    for (const name of ["items", "content", "audio"]) tx.objectStore(name).delete(id);
  });
  notify();
}

/** Asks the browser not to evict the library under storage pressure (best effort, asked once per page). */
let persistAsked = false;
export function requestPersistence(): void {
  if (persistAsked || typeof navigator === "undefined" || !navigator.storage?.persist) return;
  persistAsked = true;
  void navigator.storage.persist().catch(() => {});
}

export async function storageUsage(): Promise<number | null> {
  try {
    const { usage } = (await navigator.storage?.estimate?.()) ?? {};
    return typeof usage === "number" ? usage : null;
  } catch {
    return null;
  }
}

/** For tests: forget the open connection (e.g. after replacing the IndexedDB factory). */
export function resetConnection(): void {
  dbPromise = null;
}
