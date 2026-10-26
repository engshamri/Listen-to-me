import { changeChannel, database, IdbError, request } from "@/lib/idb";
import type { Box, Paragraph } from "./layout";

/*
 * Study data, kept in this browser (IndexedDB "asmani-study"), never uploaded:
 *   courses      – subjects that group lectures
 *   docs         – lecture metadata, reading progress
 *   files        – the PDF itself (Blob), keyed by doc id
 *   pages        – paragraphs (with positions) and saved translations, keyed [docId, page]
 *   annotations  – highlights, notes and bookmarks
 *   glossary     – preferred translations of terms
 */

export interface Course {
  id: string;
  title: string;
  createdAt: number;
}

export interface StudyDoc {
  id: string;
  courseId: string | null;
  title: string;
  fileName: string;
  size: number;
  pageCount: number;
  createdAt: number;
  lastOpenedAt: number | null;
  /** Last page the student was on (1-based). */
  lastPage: number;
  /** Pages the student has opened, sorted. */
  visited: number[];
  completed: boolean;
  /** Pages without a text layer (scanned) that have not been recognized yet. */
  scannedPages: number[];
}

export type PageSource = "text" | "ocr" | "none";

export interface PageTranslation {
  /** One translation per paragraph, aligned by index; null for paragraphs that are not translated (code, formulas). */
  paragraphs: (string | null)[];
  provider: string;
  at: number;
}

export interface StudyPage {
  docId: string;
  page: number;
  paragraphs: Paragraph[];
  source: PageSource;
  /** OCR confidence 0–100 for recognized pages. */
  confidence?: number;
  /** Saved translations by target language. */
  translations?: Record<string, PageTranslation>;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink";
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = ["yellow", "green", "blue", "pink"];

export interface Annotation {
  id: string;
  docId: string;
  page: number;
  kind: "highlight" | "bookmark";
  color: HighlightColor;
  /** The highlighted text (empty for a page bookmark). */
  quote: string;
  /** Highlighted areas on the page (fractions of the page). */
  rects: Box[];
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface GlossaryEntry {
  id: string;
  term: string;
  translation: string;
  /** Show the original term after the translation, e.g. «الميتوكوندريا (mitochondria)». */
  showOriginal: boolean;
  note: string;
  createdAt: number;
}

export { IdbError as StudyError, type IdbErrorCode as StudyErrorCode } from "@/lib/idb";

const db = database("asmani-study", 1, (idb) => {
  const ensure = (name: string, opts?: IDBObjectStoreParameters) => (idb.objectStoreNames.contains(name) ? null : idb.createObjectStore(name, opts));
  ensure("courses", { keyPath: "id" });
  ensure("docs", { keyPath: "id" })?.createIndex("courseId", "courseId");
  ensure("files");
  ensure("pages", { keyPath: ["docId", "page"] })?.createIndex("docId", "docId");
  ensure("annotations", { keyPath: "id" })?.createIndex("docId", "docId");
  ensure("glossary", { keyPath: "id" });
});
const changes = changeChannel("asmani-study");
export const subscribeStudy = changes.subscribe;

/** For tests: forget the open connection. */
export function resetStudyConnection(): void {
  db.reset();
}

const newId = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export async function listCourses(): Promise<Course[]> {
  const all = await db.transact(["courses"], "readonly", (tx) => request(tx.objectStore("courses").getAll() as IDBRequest<Course[]>));
  return all.sort((a, b) => a.title.localeCompare(b.title));
}

export async function createCourse(title: string): Promise<Course> {
  const course: Course = { id: newId(), title: title.trim() || "—", createdAt: Date.now() };
  await db.transact(["courses"], "readwrite", (tx) => void tx.objectStore("courses").put(course));
  changes.notify();
  return course;
}

export async function renameCourse(id: string, title: string): Promise<void> {
  await db.transact(["courses"], "readwrite", async (tx) => {
    const store = tx.objectStore("courses");
    const course = (await request(store.get(id) as IDBRequest<Course | undefined>)) ?? null;
    if (!course) throw new IdbError("NOT_FOUND");
    store.put({ ...course, title: title.trim() || course.title });
  });
  changes.notify();
}

/** Deletes a course; its lectures stay, without a course. */
export async function deleteCourse(id: string): Promise<void> {
  await db.transact(["courses", "docs"], "readwrite", async (tx) => {
    tx.objectStore("courses").delete(id);
    const docs = tx.objectStore("docs");
    const inCourse = await request(docs.index("courseId").getAll(id) as IDBRequest<StudyDoc[]>);
    for (const d of inCourse) docs.put({ ...d, courseId: null });
  });
  changes.notify();
}

// ---------------------------------------------------------------------------
// Lectures (documents)
// ---------------------------------------------------------------------------

/** Most recently opened (or added) first. */
export async function listDocs(): Promise<StudyDoc[]> {
  const all = await db.transact(["docs"], "readonly", (tx) => request(tx.objectStore("docs").getAll() as IDBRequest<StudyDoc[]>));
  return all.sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt));
}

export async function getDoc(id: string): Promise<StudyDoc | null> {
  return (await db.transact(["docs"], "readonly", (tx) => request(tx.objectStore("docs").get(id) as IDBRequest<StudyDoc | undefined>))) ?? null;
}

export type NewDoc = Pick<StudyDoc, "title" | "fileName" | "size" | "pageCount" | "courseId"> & {
  file: Blob;
  pages: Omit<StudyPage, "docId">[];
};

/** Saves a lecture, its PDF and its pages in one transaction. */
export async function createDoc({ file, pages, ...meta }: NewDoc): Promise<StudyDoc> {
  const doc: StudyDoc = {
    ...meta,
    id: newId(),
    createdAt: Date.now(),
    lastOpenedAt: null,
    lastPage: 1,
    visited: [],
    completed: false,
    scannedPages: pages.filter((p) => p.source === "none").map((p) => p.page),
  };
  await db.transact(["docs", "files", "pages"], "readwrite", (tx) => {
    tx.objectStore("docs").put(doc);
    tx.objectStore("files").put(file, doc.id);
    const store = tx.objectStore("pages");
    for (const p of pages) store.put({ ...p, docId: doc.id });
  });
  changes.notify();
  return doc;
}

export type DocPatch = Partial<Pick<StudyDoc, "title" | "courseId" | "lastOpenedAt" | "lastPage" | "visited" | "completed" | "scannedPages">>;

export async function updateDoc(id: string, patch: DocPatch | ((doc: StudyDoc) => DocPatch), { quiet = false } = {}): Promise<StudyDoc> {
  const updated = await db.transact(["docs"], "readwrite", async (tx) => {
    const store = tx.objectStore("docs");
    const doc = (await request(store.get(id) as IDBRequest<StudyDoc | undefined>)) ?? null;
    if (!doc) throw new IdbError("NOT_FOUND");
    const next = { ...doc, ...(typeof patch === "function" ? patch(doc) : patch) };
    store.put(next);
    return next;
  });
  if (!quiet) changes.notify();
  return updated;
}

/** Records that `page` was opened: last page, visited pages, last opened time. Quiet (no list refresh). */
export function recordVisit(id: string, page: number): Promise<StudyDoc> {
  return updateDoc(
    id,
    (d) => ({
      lastPage: page,
      lastOpenedAt: Date.now(),
      visited: d.visited.includes(page) ? d.visited : [...d.visited, page].sort((a, b) => a - b),
    }),
    { quiet: true },
  );
}

export async function getFile(id: string): Promise<Blob> {
  const file = await db.transact(["files"], "readonly", (tx) => request(tx.objectStore("files").get(id) as IDBRequest<Blob | undefined>));
  if (!file) throw new IdbError("NOT_FOUND");
  return file;
}

export async function deleteDoc(id: string): Promise<void> {
  await db.transact(["docs", "files", "pages", "annotations"], "readwrite", async (tx) => {
    tx.objectStore("docs").delete(id);
    tx.objectStore("files").delete(id);
    const pages = tx.objectStore("pages");
    for (const key of await request(pages.index("docId").getAllKeys(id))) pages.delete(key);
    const notes = tx.objectStore("annotations");
    for (const key of await request(notes.index("docId").getAllKeys(id))) notes.delete(key);
  });
  changes.notify();
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export async function getPages(docId: string): Promise<StudyPage[]> {
  const pages = await db.transact(["pages"], "readonly", (tx) => request(tx.objectStore("pages").index("docId").getAll(docId) as IDBRequest<StudyPage[]>));
  return pages.sort((a, b) => a.page - b.page);
}

/** Changes one page in a read-modify-write transaction (OCR results, translations). */
export async function updatePage(docId: string, page: number, fn: (p: StudyPage) => Partial<StudyPage>): Promise<StudyPage> {
  const updated = await db.transact(["pages"], "readwrite", async (tx) => {
    const store = tx.objectStore("pages");
    const current = (await request(store.get([docId, page]) as IDBRequest<StudyPage | undefined>)) ?? null;
    if (!current) throw new IdbError("NOT_FOUND");
    const next = { ...current, ...fn(current), docId, page };
    store.put(next);
    return next;
  });
  changes.notify();
  return updated;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export async function listAnnotations(docId: string): Promise<Annotation[]> {
  const all = await db.transact(["annotations"], "readonly", (tx) => request(tx.objectStore("annotations").index("docId").getAll(docId) as IDBRequest<Annotation[]>));
  return all.sort((a, b) => a.page - b.page || (a.rects[0]?.[1] ?? 0) - (b.rects[0]?.[1] ?? 0) || a.createdAt - b.createdAt);
}

export async function addAnnotation(a: Omit<Annotation, "id" | "createdAt" | "updatedAt">): Promise<Annotation> {
  const now = Date.now();
  const annotation: Annotation = { ...a, id: newId(), createdAt: now, updatedAt: now };
  await db.transact(["annotations"], "readwrite", (tx) => void tx.objectStore("annotations").put(annotation));
  changes.notify();
  return annotation;
}

export async function updateAnnotation(id: string, patch: Partial<Pick<Annotation, "note" | "color">>): Promise<void> {
  await db.transact(["annotations"], "readwrite", async (tx) => {
    const store = tx.objectStore("annotations");
    const a = (await request(store.get(id) as IDBRequest<Annotation | undefined>)) ?? null;
    if (!a) throw new IdbError("NOT_FOUND");
    store.put({ ...a, ...patch, updatedAt: Date.now() });
  });
  changes.notify();
}

export async function deleteAnnotation(id: string): Promise<void> {
  await db.transact(["annotations"], "readwrite", (tx) => void tx.objectStore("annotations").delete(id));
  changes.notify();
}

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export async function listGlossary(): Promise<GlossaryEntry[]> {
  const all = await db.transact(["glossary"], "readonly", (tx) => request(tx.objectStore("glossary").getAll() as IDBRequest<GlossaryEntry[]>));
  return all.sort((a, b) => a.term.localeCompare(b.term));
}

/** Adds a term, or replaces the entry for the same term (case-insensitive). */
export async function saveGlossaryEntry(entry: Pick<GlossaryEntry, "term" | "translation" | "showOriginal" | "note">): Promise<GlossaryEntry> {
  const term = entry.term.replace(/\s+/gu, " ").trim();
  if (!term) throw new IdbError("FAILED");
  const saved = await db.transact(["glossary"], "readwrite", async (tx) => {
    const store = tx.objectStore("glossary");
    const all = await request(store.getAll() as IDBRequest<GlossaryEntry[]>);
    const existing = all.find((g) => g.term.toLowerCase() === term.toLowerCase());
    const next: GlossaryEntry = { ...entry, term, translation: entry.translation.trim(), id: existing?.id ?? newId(), createdAt: existing?.createdAt ?? Date.now() };
    store.put(next);
    return next;
  });
  changes.notify();
  return saved;
}

export async function deleteGlossaryEntry(id: string): Promise<void> {
  await db.transact(["glossary"], "readwrite", (tx) => void tx.objectStore("glossary").delete(id));
  changes.notify();
}
