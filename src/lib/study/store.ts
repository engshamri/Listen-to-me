import { changeChannel, database, IdbError, request } from "@/lib/idb";
import type { Box, Paragraph } from "./layout";
import type { Answer, Difficulty, Question } from "./quiz";
import { newSrs, schedule, type Grade, type Srs } from "./srs";

/*
 * Study data, kept in this browser (IndexedDB "asmani-study"), never uploaded:
 *   courses      – subjects that group lectures
 *   docs         – lecture metadata, reading progress
 *   files        – the PDF itself (Blob), keyed by doc id
 *   pages        – paragraphs (with positions) and saved translations, keyed [docId, page]
 *   annotations  – highlights, notes and bookmarks
 *   glossary     – preferred translations of terms
 *   cards        – flashcards with their spaced-repetition schedule
 *   quizzes      – practice and exam results
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

export type CardSource = "definition" | "glossary" | "highlight" | "manual";

export interface Card {
  id: string;
  /** The lecture it comes from (null for cards made outside a lecture, e.g. from the glossary). */
  docId: string | null;
  front: string;
  back: string;
  source: CardSource;
  page: number | null;
  createdAt: number;
  srs: Srs;
  history: { at: number; grade: Grade }[];
}

export interface QuizResult {
  id: string;
  docId: string;
  createdAt: number;
  difficulty: Difficulty;
  mode: "practice" | "exam";
  correct: number;
  total: number;
  percent: number;
  durationMs: number;
  questions: Question[];
  answers: Record<string, Answer>;
}

export { IdbError as StudyError, type IdbErrorCode as StudyErrorCode } from "@/lib/idb";

const db = database("asmani-study", 2, (idb) => {
  const ensure = (name: string, opts?: IDBObjectStoreParameters) => (idb.objectStoreNames.contains(name) ? null : idb.createObjectStore(name, opts));
  ensure("courses", { keyPath: "id" });
  ensure("docs", { keyPath: "id" })?.createIndex("courseId", "courseId");
  ensure("files");
  ensure("pages", { keyPath: ["docId", "page"] })?.createIndex("docId", "docId");
  ensure("annotations", { keyPath: "id" })?.createIndex("docId", "docId");
  ensure("glossary", { keyPath: "id" });
  // Version 2: flashcards and quiz results.
  ensure("cards", { keyPath: "id" })?.createIndex("docId", "docId");
  ensure("quizzes", { keyPath: "id" })?.createIndex("docId", "docId");
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

/** Ids of the lectures whose PDF is stored on this device. */
export async function listFileIds(): Promise<Set<string>> {
  const keys = await db.transact(["files"], "readonly", (tx) => request(tx.objectStore("files").getAllKeys()));
  return new Set(keys as string[]);
}

/** Stores the PDF of a lecture that was restored from a backup without it. */
export async function attachFile(id: string, file: Blob): Promise<void> {
  await db.transact(["docs", "files"], "readwrite", async (tx) => {
    if (!(await request(tx.objectStore("docs").getKey(id)))) throw new IdbError("NOT_FOUND");
    tx.objectStore("files").put(file, id);
  });
  changes.notify();
}

export async function deleteDoc(id: string): Promise<void> {
  await db.transact(["docs", "files", "pages", "annotations", "cards", "quizzes"], "readwrite", async (tx) => {
    tx.objectStore("docs").delete(id);
    tx.objectStore("files").delete(id);
    for (const name of ["pages", "annotations", "cards", "quizzes"]) {
      const store = tx.objectStore(name);
      for (const key of await request(store.index("docId").getAllKeys(id))) store.delete(key);
    }
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

// ---------------------------------------------------------------------------
// Flashcards
// ---------------------------------------------------------------------------

const cardKey = (front: string) => front.replace(/\s+/gu, " ").trim().toLowerCase();

/** Cards of one lecture, or all cards when docId is undefined. Newest first. */
export async function listCards(docId?: string): Promise<Card[]> {
  const all = await db.transact(["cards"], "readonly", (tx) => {
    const store = tx.objectStore("cards");
    return request((docId === undefined ? store.getAll() : store.index("docId").getAll(docId)) as IDBRequest<Card[]>);
  });
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/** Adds cards, skipping any whose front already exists for the same lecture. Returns how many were added. */
export async function addCards(cards: Pick<Card, "docId" | "front" | "back" | "source" | "page">[]): Promise<number> {
  const now = Date.now();
  const added = await db.transact(["cards"], "readwrite", async (tx) => {
    const store = tx.objectStore("cards");
    const existing = await request(store.getAll() as IDBRequest<Card[]>);
    const seen = new Set(existing.map((c) => `${c.docId ?? ""}|${cardKey(c.front)}`));
    let n = 0;
    for (const c of cards) {
      const front = c.front.trim().slice(0, 2000);
      const back = c.back.trim().slice(0, 4000);
      const key = `${c.docId ?? ""}|${cardKey(front)}`;
      if (!front || !back || seen.has(key)) continue;
      seen.add(key);
      store.put({ ...c, front, back, id: newId(), createdAt: now + n, srs: newSrs(now), history: [] } satisfies Card);
      n++;
    }
    return n;
  });
  if (added) changes.notify();
  return added;
}

export async function updateCard(id: string, patch: Partial<Pick<Card, "front" | "back">>): Promise<void> {
  await db.transact(["cards"], "readwrite", async (tx) => {
    const store = tx.objectStore("cards");
    const card = (await request(store.get(id) as IDBRequest<Card | undefined>)) ?? null;
    if (!card) throw new IdbError("NOT_FOUND");
    store.put({ ...card, ...patch });
  });
  changes.notify();
}

/** Records a review and schedules the card's next appearance. */
export async function reviewCard(id: string, grade: Grade, now = Date.now()): Promise<Card> {
  const updated = await db.transact(["cards"], "readwrite", async (tx) => {
    const store = tx.objectStore("cards");
    const card = (await request(store.get(id) as IDBRequest<Card | undefined>)) ?? null;
    if (!card) throw new IdbError("NOT_FOUND");
    const next: Card = { ...card, srs: schedule(card.srs, grade, now), history: [...card.history, { at: now, grade }].slice(-200) };
    store.put(next);
    return next;
  });
  changes.notify();
  return updated;
}

export async function deleteCard(id: string): Promise<void> {
  await db.transact(["cards"], "readwrite", (tx) => void tx.objectStore("cards").delete(id));
  changes.notify();
}

// ---------------------------------------------------------------------------
// Quiz results
// ---------------------------------------------------------------------------

export async function saveQuizResult(result: Omit<QuizResult, "id" | "createdAt">): Promise<QuizResult> {
  const saved: QuizResult = { ...result, id: newId(), createdAt: Date.now() };
  await db.transact(["quizzes"], "readwrite", (tx) => void tx.objectStore("quizzes").put(saved));
  changes.notify();
  return saved;
}

/** Results of one lecture (or all), newest first. */
export async function listQuizResults(docId?: string): Promise<QuizResult[]> {
  const all = await db.transact(["quizzes"], "readonly", (tx) => {
    const store = tx.objectStore("quizzes");
    return request((docId === undefined ? store.getAll() : store.index("docId").getAll(docId)) as IDBRequest<QuizResult[]>);
  });
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------------------
// Backup and restore (everything in the study database)
// ---------------------------------------------------------------------------

export interface StudyDump {
  courses: Course[];
  docs: StudyDoc[];
  pages: StudyPage[];
  annotations: Annotation[];
  glossary: GlossaryEntry[];
  cards: Card[];
  quizzes: QuizResult[];
  files: Map<string, Blob>;
}

const DATA_STORES = ["courses", "docs", "pages", "annotations", "glossary", "cards", "quizzes"] as const;

export async function dumpStudyData({ withFiles }: { withFiles: boolean }): Promise<StudyDump> {
  return db.transact([...DATA_STORES, "files"], "readonly", async (tx) => {
    const [courses, docs, pages, annotations, glossary, cards, quizzes] = await Promise.all(DATA_STORES.map((name) => request(tx.objectStore(name).getAll())));
    const files = new Map<string, Blob>();
    if (withFiles) {
      const store = tx.objectStore("files");
      const keys = (await request(store.getAllKeys())) as string[];
      const blobs = (await request(store.getAll())) as Blob[];
      keys.forEach((k, i) => files.set(k, blobs[i]));
    }
    return { courses, docs, pages, annotations, glossary, cards, quizzes, files } as StudyDump;
  });
}

/** Writes a backup into the database; records with the same id are replaced. */
export async function restoreStudyData(data: StudyDump): Promise<void> {
  await db.transact([...DATA_STORES, "files"], "readwrite", (tx) => {
    for (const name of DATA_STORES) {
      const store = tx.objectStore(name);
      for (const record of data[name] as object[]) store.put(record);
    }
    const files = tx.objectStore("files");
    for (const [id, blob] of data.files) files.put(blob, id);
  });
  changes.notify();
}
