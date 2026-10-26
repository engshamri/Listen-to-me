/*
 * Backup and restore of Study: one JSON file with courses, lectures, pages,
 * translations, notes, glossary, flashcards and quiz results, and optionally
 * the lecture PDFs (base64). The whole file is checked before anything is
 * written; restoring adds to what is on this device and replaces records
 * that have the same id.
 */
import { z } from "zod";
import { dumpStudyData, listFileIds, restoreStudyData, type StudyDump } from "./store";

export const BACKUP_FORMAT = "listen-to-me/study-backup";
export const BACKUP_VERSION = 1;
/** Largest backup file we try to read (PDFs included). */
export const MAX_BACKUP_BYTES = 500 * 1024 * 1024;

export type BackupErrorCode = "NOT_BACKUP" | "NEWER" | "INVALID" | "TOO_LARGE";

export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode) {
    super(code);
  }
}

// ---------------------------------------------------------------------------
// Schemas (unknown fields are dropped)
// ---------------------------------------------------------------------------

const id = z.string().min(1).max(200);
const time = z.number().finite().nonnegative();
const pageNo = z.number().int().min(1).max(100_000);
const text = (max: number) => z.string().max(max);
const box = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const course = z.object({ id, title: text(500), createdAt: time });

const doc = z.object({
  id,
  courseId: id.nullable(),
  title: text(500),
  fileName: text(500),
  size: z.number().int().nonnegative(),
  pageCount: pageNo,
  createdAt: time,
  lastOpenedAt: time.nullable(),
  lastPage: pageNo,
  visited: z.array(pageNo),
  completed: z.boolean(),
  scannedPages: z.array(pageNo),
});

const paragraph = z.object({ text: text(200_000), kind: z.enum(["text", "heading", "list", "code", "math", "table"]), box });

const page = z.object({
  docId: id,
  page: pageNo,
  paragraphs: z.array(paragraph),
  source: z.enum(["text", "ocr", "none"]),
  confidence: z.number().min(0).max(100).optional(),
  translations: z.record(text(20), z.object({ paragraphs: z.array(text(400_000).nullable()), provider: text(100), at: time })).optional(),
});

const annotation = z.object({
  id,
  docId: id,
  page: pageNo,
  kind: z.enum(["highlight", "bookmark"]),
  color: z.enum(["yellow", "green", "blue", "pink"]),
  quote: text(10_000),
  rects: z.array(box),
  note: text(100_000),
  createdAt: time,
  updatedAt: time,
});

const glossary = z.object({ id, term: text(500), translation: text(1000), showOriginal: z.boolean(), note: text(10_000), createdAt: time });

const grade = z.enum(["again", "hard", "medium", "easy"]);
const card = z.object({
  id,
  docId: id.nullable(),
  front: text(2000),
  back: text(4000),
  source: z.enum(["definition", "glossary", "highlight", "manual"]),
  page: pageNo.nullable(),
  createdAt: time,
  srs: z.object({ due: time, interval: z.number().nonnegative(), ease: z.number().min(1.3).max(5), reps: z.number().int().nonnegative(), lapses: z.number().int().nonnegative(), last: time.nullable() }),
  history: z.array(z.object({ at: time, grade })),
});

const base = { id: text(50), page: pageNo, box, source: text(20_000) };
const question = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("mcq-term"), definition: text(2000), options: z.array(text(2000)), answer: text(2000) }),
  z.object({ ...base, kind: z.literal("mcq-definition"), term: text(500), options: z.array(text(2000)), answer: text(2000) }),
  z.object({ ...base, kind: z.literal("true-false"), term: text(500), definition: text(2000), answer: z.boolean(), correctDefinition: text(2000) }),
  z.object({ ...base, kind: z.literal("fill-blank"), prompt: text(20_000), answer: text(500) }),
  z.object({
    ...base,
    kind: z.literal("matching"),
    terms: z.array(text(500)),
    definitions: z.array(text(2000)),
    answer: z.record(text(500), text(2000)),
    sources: z.array(z.object({ term: text(500), page: pageNo })),
  }),
]);
const answer = z.union([text(20_000), z.boolean(), z.record(text(500), text(2000)), z.null()]);

const quiz = z.object({
  id,
  docId: id,
  createdAt: time,
  difficulty: z.enum(["easy", "medium", "hard"]),
  mode: z.enum(["practice", "exam"]),
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  durationMs: time,
  questions: z.array(question),
  answers: z.record(text(50), answer),
});

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int(),
  exportedAt: z.string(),
  data: z.object({
    courses: z.array(course),
    docs: z.array(doc),
    pages: z.array(page),
    annotations: z.array(annotation),
    glossary: z.array(glossary),
    cards: z.array(card),
    quizzes: z.array(quiz),
  }),
  files: z.record(id, z.object({ type: text(100), base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/) })),
});

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Base64 of the bytes, in pieces that join into one valid string (each piece covers a multiple of 3 bytes). */
function base64Parts(bytes: Uint8Array): string[] {
  const parts: string[] = [];
  const CHUNK = 3 * 16_384;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    let binary = "";
    for (let j = 0; j < slice.length; j += 8192) binary += String.fromCharCode(...slice.subarray(j, j + 8192));
    parts.push(btoa(binary));
  }
  return parts;
}

/** The backup file of everything in Study on this device. */
export async function createBackup({ withFiles }: { withFiles: boolean }): Promise<Blob> {
  const { files, ...data } = await dumpStudyData({ withFiles });
  const parts: BlobPart[] = [
    `{"format":${JSON.stringify(BACKUP_FORMAT)},"version":${BACKUP_VERSION},"exportedAt":${JSON.stringify(new Date().toISOString())},"data":${JSON.stringify(data)},"files":{`,
  ];
  let first = true;
  for (const [docId, blob] of files) {
    parts.push(`${first ? "" : ","}${JSON.stringify(docId)}:{"type":${JSON.stringify(blob.type || "application/pdf")},"base64":"`, ...base64Parts(new Uint8Array(await blob.arrayBuffer())), `"}`);
    first = false;
  }
  parts.push("}}");
  return new Blob(parts, { type: "application/json" });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface BackupSummary {
  courses: number;
  lectures: number;
  notes: number;
  cards: number;
  quizzes: number;
  pdfs: number;
  /** Titles of restored lectures whose PDF is neither in the backup nor on this device. */
  missingPdfs: string[];
}

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Reads and checks a backup file; throws BackupError when it isn't a valid backup. */
export async function readBackup(file: Blob): Promise<StudyDump> {
  if (file.size > MAX_BACKUP_BYTES) throw new BackupError("TOO_LARGE");
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new BackupError("NOT_BACKUP");
  }
  const format = (raw as { format?: unknown } | null)?.format;
  if (format !== BACKUP_FORMAT) throw new BackupError("NOT_BACKUP");
  const version = (raw as { version?: unknown }).version;
  if (typeof version === "number" && version > BACKUP_VERSION) throw new BackupError("NEWER");
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) throw new BackupError("INVALID");
  const { data, files } = parsed.data;

  // Everything that belongs to a lecture must belong to a lecture in the backup.
  const docIds = new Set(data.docs.map((d) => d.id));
  const courseIds = new Set(data.courses.map((c) => c.id));
  const linked = [...data.pages, ...data.annotations, ...data.quizzes].every((r) => docIds.has(r.docId)) && data.cards.every((c) => c.docId === null || docIds.has(c.docId));
  if (!linked || !data.docs.every((d) => d.courseId === null || courseIds.has(d.courseId)) || !Object.keys(files).every((k) => docIds.has(k))) throw new BackupError("INVALID");

  const blobs = new Map<string, Blob>();
  for (const [docId, f] of Object.entries(files)) {
    const bytes = decode(f.base64);
    // Only PDFs: "%PDF" at the start.
    if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) throw new BackupError("INVALID");
    blobs.set(docId, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
  }
  return { ...data, files: blobs };
}

/** Restores a checked backup; returns what was restored. */
export async function restoreBackup(file: Blob): Promise<BackupSummary> {
  const dump = await readBackup(file);
  await restoreStudyData(dump);
  const present = await listFileIds();
  return {
    courses: dump.courses.length,
    lectures: dump.docs.length,
    notes: dump.annotations.length,
    cards: dump.cards.length,
    quizzes: dump.quizzes.length,
    pdfs: dump.files.size,
    missingPdfs: dump.docs.filter((d) => !present.has(d.id)).map((d) => d.title),
  };
}
