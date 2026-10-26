import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { BackupError, createBackup, readBackup, restoreBackup } from "@/lib/study/backup";
import { cardsCsv, cardsJson, parseCards } from "@/lib/study/cards-io";
import {
  addCards,
  attachFile,
  createCourse,
  createDoc,
  deleteDoc,
  dumpStudyData,
  getFile,
  listCards,
  listDocs,
  listQuizResults,
  resetStudyConnection,
  restoreStudyData,
  reviewCard,
  saveQuizResult,
  type NewDoc,
} from "@/lib/study/store";

const lecture: NewDoc = {
  title: "Lecture 1",
  fileName: "Lecture 1.pdf",
  size: 4,
  pageCount: 1,
  courseId: null,
  file: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }),
  pages: [{ page: 1, paragraphs: [{ text: "Enzymes are catalysts.", kind: "text", box: [0.1, 0.1, 0.8, 0.05] }], source: "text" }],
};

const result = (docId: string) => ({ docId, difficulty: "easy" as const, mode: "practice" as const, correct: 1, total: 2, percent: 50, durationMs: 1000, questions: [], answers: {} });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStudyConnection();
});

describe("flashcards and quiz results", () => {
  it("adds cards once per lecture and front, ignoring case and spacing", async () => {
    const doc = await createDoc(lecture);
    const card = { docId: doc.id, front: "Enzymes", back: "biological catalysts", source: "definition" as const, page: 1 };
    expect(await addCards([card, { ...card, front: "  enzymes " }, { ...card, back: "" }])).toBe(1);
    expect(await addCards([card])).toBe(0);
    expect(await addCards([{ ...card, docId: null, source: "manual" }])).toBe(1);
    expect(await listCards(doc.id)).toHaveLength(1);
    expect(await listCards()).toHaveLength(2);
  });

  it("reviewing a card schedules it and keeps its history", async () => {
    const doc = await createDoc(lecture);
    await addCards([{ docId: doc.id, front: "ATP", back: "energy currency", source: "manual", page: null }]);
    const [card] = await listCards(doc.id);
    const now = Date.UTC(2026, 9, 26);
    const reviewed = await reviewCard(card.id, "medium", now);
    expect(reviewed.srs.interval).toBe(1);
    expect(reviewed.srs.due).toBe(now + 86_400_000);
    expect(reviewed.history).toEqual([{ at: now, grade: "medium" }]);
  });

  it("deleting a lecture deletes its cards and quiz results", async () => {
    const doc = await createDoc(lecture);
    await addCards([{ docId: doc.id, front: "ATP", back: "energy currency", source: "manual", page: null }]);
    await saveQuizResult(result(doc.id));
    expect(await listQuizResults(doc.id)).toHaveLength(1);
    await deleteDoc(doc.id);
    expect(await listCards()).toEqual([]);
    expect(await listQuizResults()).toEqual([]);
  });

  it("a backup restores everything into an empty database", async () => {
    const doc = await createDoc(lecture);
    await addCards([{ docId: doc.id, front: "ATP", back: "energy currency", source: "manual", page: null }]);
    await saveQuizResult(result(doc.id));
    const dump = await dumpStudyData({ withFiles: true });
    expect(dump.files.size).toBe(1);
    expect((await dumpStudyData({ withFiles: false })).files.size).toBe(0);

    globalThis.indexedDB = new IDBFactory();
    resetStudyConnection();
    await restoreStudyData(dump);
    const again = await dumpStudyData({ withFiles: true });
    expect(again.docs.map((d) => d.id)).toEqual([doc.id]);
    expect(again.pages).toHaveLength(1);
    expect(again.cards).toHaveLength(1);
    expect(again.quizzes).toHaveLength(1);
    expect([...new Uint8Array(await again.files.get(doc.id)!.arrayBuffer())]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });
});

describe("backup file", () => {
  async function fresh() {
    globalThis.indexedDB = new IDBFactory();
    resetStudyConnection();
  }

  it("round-trips everything, with the PDFs, through one JSON file", async () => {
    const course = await createCourse("Biochemistry");
    const doc = await createDoc({ ...lecture, courseId: course.id });
    await addCards([{ docId: doc.id, front: "ATP", back: "energy currency", source: "manual", page: null }]);
    await saveQuizResult(result(doc.id));
    const file = await createBackup({ withFiles: true });
    const json = JSON.parse(await file.text());
    expect(json.format).toBe("listen-to-me/study-backup");
    expect(json.version).toBe(1);

    await fresh();
    const summary = await restoreBackup(file);
    expect(summary).toEqual({ courses: 1, lectures: 1, notes: 0, cards: 1, quizzes: 1, pdfs: 1, missingPdfs: [] });
    expect((await listDocs()).map((d) => [d.title, d.courseId])).toEqual([["Lecture 1", course.id]]);
    expect([...new Uint8Array(await (await getFile(doc.id)).arrayBuffer())]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("encodes larger PDFs exactly (base64 written in pieces)", async () => {
    const bytes = new Uint8Array(200_003).map((_, i) => (i * 7919) % 256);
    bytes.set([0x25, 0x50, 0x44, 0x46]);
    const doc = await createDoc({ ...lecture, file: new Blob([bytes], { type: "application/pdf" }) });
    const file = await createBackup({ withFiles: true });
    await fresh();
    await restoreBackup(file);
    expect(new Uint8Array(await (await getFile(doc.id)).arrayBuffer())).toEqual(bytes);
  });

  it("without PDFs, lists the lectures whose PDF must be chosen again, which can then be attached", async () => {
    const doc = await createDoc(lecture);
    const file = await createBackup({ withFiles: false });
    await fresh();
    const summary = await restoreBackup(file);
    expect(summary.missingPdfs).toEqual(["Lecture 1"]);
    await expect(getFile(doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await attachFile(doc.id, lecture.file);
    expect((await getFile(doc.id)).size).toBe(4);
    await expect(attachFile("nope", lecture.file)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects files that are not valid backups, before writing anything", async () => {
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: BackupError) => e.code);
    const blob = (x: unknown) => new Blob([typeof x === "string" ? x : JSON.stringify(x)]);
    const doc = await createDoc(lecture);
    const valid = JSON.parse(await (await createBackup({ withFiles: true })).text());
    await fresh();

    expect(await code(readBackup(blob("not json")))).toBe("NOT_BACKUP");
    expect(await code(readBackup(blob({ hello: 1 })))).toBe("NOT_BACKUP");
    expect(await code(readBackup(blob({ ...valid, version: 99 })))).toBe("NEWER");
    expect(await code(readBackup(blob({ ...valid, data: { ...valid.data, docs: [{ ...valid.data.docs[0], pageCount: "x" }] } })))).toBe("INVALID");
    // A page of a lecture that isn't in the backup.
    expect(await code(readBackup(blob({ ...valid, data: { ...valid.data, docs: [] }, files: {} })))).toBe("INVALID");
    // A file that isn't a PDF.
    expect(await code(readBackup(blob({ ...valid, files: { [doc.id]: { type: "application/pdf", base64: btoa("MZ executable") } } })))).toBe("INVALID");
    expect(await code(restoreBackup(blob({ ...valid, version: 99 })))).toBe("NEWER");
    expect(await listDocs()).toEqual([]);
    expect(await code(readBackup(blob(valid)))).toBe("ok");
  });
});

describe("flashcard files", () => {
  const cards = [
    { front: "ATP", back: "the energy currency, of the cell", page: 2 },
    { front: 'The "Km" value', back: "line one\nline two", page: null },
    { front: "الإنزيم", back: "عامل حفّاز حيوي", page: 1 },
  ];

  it("CSV and JSON exports read back exactly", () => {
    const csv = cardsCsv(cards);
    expect(csv.startsWith("#separator:comma\n")).toBe(true);
    expect(parseCards(csv)).toEqual(cards.map(({ front, back }) => ({ front, back })));
    expect(parseCards(cardsJson(cards))).toEqual(cards.map(({ front, back }) => ({ front, back })));
  });

  it("reads hand-made files: tab-separated, with a header row, skipping incomplete rows", () => {
    expect(parseCards("Front\tBack\nCell\tUnit of life\nEmpty\t\n")).toEqual([{ front: "Cell", back: "Unit of life" }]);
    expect(parseCards("front,back\r\nOsmosis,water movement\r\n")).toEqual([{ front: "Osmosis", back: "water movement" }]);
    expect(parseCards('[{"front":"A","back":"B"},{"front":1,"back":"x"},"junk"]')).toEqual([{ front: "A", back: "B" }]);
    expect(parseCards("{ broken")).toEqual([]);
  });
});
