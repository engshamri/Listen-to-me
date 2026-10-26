import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Paragraph } from "@/lib/study/layout";
import {
  addAnnotation,
  createCourse,
  createDoc,
  deleteAnnotation,
  deleteCourse,
  deleteDoc,
  deleteGlossaryEntry,
  getDoc,
  getFile,
  getPages,
  listAnnotations,
  listCourses,
  listDocs,
  listGlossary,
  recordVisit,
  renameCourse,
  resetStudyConnection,
  saveGlossaryEntry,
  subscribeStudy,
  updateAnnotation,
  updateDoc,
  updatePage,
  type NewDoc,
} from "@/lib/study/store";

const para = (text: string): Paragraph => ({ text, kind: "text", box: [0.1, 0.1, 0.8, 0.05] });

function lecture(title = "Lecture 1"): NewDoc {
  return {
    title,
    fileName: `${title}.pdf`,
    size: 4,
    pageCount: 3,
    courseId: null,
    file: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }),
    pages: [
      { page: 1, paragraphs: [para("Cells are the units of life.")], source: "text" },
      { page: 2, paragraphs: [], source: "none" },
      { page: 3, paragraphs: [para("Enzymes speed up reactions.")], source: "text" },
    ],
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStudyConnection();
});

describe("study store", () => {
  it("saves a lecture with its PDF and pages; scanned pages are listed", async () => {
    const doc = await createDoc(lecture());
    expect(doc.scannedPages).toEqual([2]);
    expect(doc.lastPage).toBe(1);
    expect((await listDocs()).map((d) => d.id)).toEqual([doc.id]);
    expect([...new Uint8Array(await (await getFile(doc.id)).arrayBuffer())]).toEqual([0x25, 0x50, 0x44, 0x46]);
    const pages = await getPages(doc.id);
    expect(pages.map((p) => [p.page, p.source])).toEqual([[1, "text"], [2, "none"], [3, "text"]]);
    expect(pages[0].paragraphs[0].text).toBe("Cells are the units of life.");
  });

  it("records reading progress and saves OCR results and translations per page", async () => {
    const doc = await createDoc(lecture());
    await recordVisit(doc.id, 3);
    await recordVisit(doc.id, 1);
    await recordVisit(doc.id, 3);
    let saved = (await getDoc(doc.id))!;
    expect(saved.lastPage).toBe(3);
    expect(saved.visited).toEqual([1, 3]);

    await updatePage(doc.id, 2, () => ({ paragraphs: [para("Recognized text.")], source: "ocr", confidence: 64 }));
    await updateDoc(doc.id, (d) => ({ scannedPages: d.scannedPages.filter((p) => p !== 2) }));
    await updatePage(doc.id, 1, (p) => ({ translations: { ...p.translations, ar: { paragraphs: ["الخلايا هي وحدات الحياة."], provider: "Google Translate", at: 1 } } }));
    const pages = await getPages(doc.id);
    expect(pages[1]).toMatchObject({ source: "ocr", confidence: 64 });
    expect(pages[0].translations?.ar.paragraphs).toEqual(["الخلايا هي وحدات الحياة."]);
    saved = (await getDoc(doc.id))!;
    expect(saved.scannedPages).toEqual([]);
  });

  it("groups lectures in courses; deleting a course keeps its lectures", async () => {
    const biology = await createCourse("Biology");
    await createCourse("Anatomy");
    const doc = await createDoc({ ...lecture(), courseId: biology.id });
    expect((await listCourses()).map((c) => c.title)).toEqual(["Anatomy", "Biology"]);
    await renameCourse(biology.id, "Cell biology");
    expect((await listCourses()).map((c) => c.title)).toEqual(["Anatomy", "Cell biology"]);
    await deleteCourse(biology.id);
    expect((await listCourses()).map((c) => c.title)).toEqual(["Anatomy"]);
    expect((await getDoc(doc.id))!.courseId).toBeNull();
  });

  it("stores highlights, notes and bookmarks per lecture, ordered by page", async () => {
    const doc = await createDoc(lecture());
    const other = await createDoc(lecture("Lecture 2"));
    const h = await addAnnotation({ docId: doc.id, page: 3, kind: "highlight", color: "yellow", quote: "Enzymes", rects: [[0.1, 0.4, 0.2, 0.02]], note: "" });
    await addAnnotation({ docId: doc.id, page: 1, kind: "bookmark", color: "blue", quote: "", rects: [], note: "Start here" });
    await addAnnotation({ docId: other.id, page: 1, kind: "bookmark", color: "blue", quote: "", rects: [], note: "" });
    await updateAnnotation(h.id, { note: "Learn this", color: "green" });
    const list = await listAnnotations(doc.id);
    expect(list.map((a) => [a.page, a.kind, a.note, a.color])).toEqual([
      [1, "bookmark", "Start here", "blue"],
      [3, "highlight", "Learn this", "green"],
    ]);
    await deleteAnnotation(h.id);
    expect(await listAnnotations(doc.id)).toHaveLength(1);
  });

  it("deletes a lecture with its file, pages and annotations", async () => {
    const doc = await createDoc(lecture());
    await addAnnotation({ docId: doc.id, page: 1, kind: "bookmark", color: "blue", quote: "", rects: [], note: "" });
    await deleteDoc(doc.id);
    expect(await listDocs()).toEqual([]);
    expect(await getPages(doc.id)).toEqual([]);
    expect(await listAnnotations(doc.id)).toEqual([]);
    await expect(getFile(doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps one glossary entry per term (case-insensitive)", async () => {
    await saveGlossaryEntry({ term: " Mitochondria ", translation: "الميتوكوندريا", showOriginal: true, note: "" });
    const updated = await saveGlossaryEntry({ term: "mitochondria", translation: "المتقدرات", showOriginal: false, note: "preferred" });
    await saveGlossaryEntry({ term: "Enzyme", translation: "إنزيم", showOriginal: false, note: "" });
    const all = await listGlossary();
    expect(all.map((g) => [g.term, g.translation])).toEqual([["Enzyme", "إنزيم"], ["mitochondria", "المتقدرات"]]);
    await deleteGlossaryEntry(updated.id);
    expect((await listGlossary()).map((g) => g.term)).toEqual(["Enzyme"]);
  });

  it("notifies subscribers of changes, except quiet progress updates", async () => {
    const listener = vi.fn();
    const off = subscribeStudy(listener);
    const doc = await createDoc(lecture());
    await recordVisit(doc.id, 2);
    await updateDoc(doc.id, { completed: true });
    off();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
