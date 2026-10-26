import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LibraryError,
  deleteItem,
  excerptFrom,
  getItem,
  listItems,
  loadRecording,
  resetConnection,
  saveRecording,
  sortItems,
  subscribe,
  titleFrom,
  updateItem,
  type LibraryItem,
  type NewRecording,
} from "@/lib/library/store";
import type { Timeline } from "@/lib/tts/timeline";

const TIMELINE: Timeline = {
  text: "Lesson 1: Cells\n\nThe cell membrane controls what enters and leaves.",
  sentences: [{ from: 0, to: 15, start: 0, end: 1.2 }],
  words: [{ from: 0, to: 6, start: 0, end: 0.4 }],
  approximate: false,
};

function recording(text = TIMELINE.text): NewRecording {
  return {
    voiceId: "en-US-AndrewNeural",
    speed: 1,
    pitch: 0,
    duration: 12.5,
    size: 4,
    partsDone: 1,
    partsTotal: 1,
    backupParts: [],
    timeline: { ...TIMELINE, text },
    audio: new Blob([new Uint8Array([0xff, 0xf3, 1, 2])], { type: "audio/mpeg" }),
  };
}

beforeEach(() => {
  // A fresh, empty database for every test.
  globalThis.indexedDB = new IDBFactory();
  resetConnection();
});

describe("titleFrom", () => {
  it("uses the first non-empty line, with spaces tidied", () => {
    expect(titleFrom("\n\n  Lesson 1:   Cells  \nmore")).toBe("Lesson 1: Cells");
    expect(titleFrom("الفصل الأول: الخلية\nنص")).toBe("الفصل الأول: الخلية");
  });
  it("cuts long lines at a word and adds an ellipsis", () => {
    const line = "word ".repeat(40).trim();
    const title = titleFrom(line);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith("word…")).toBe(true);
  });
  it("is empty for blank text", () => {
    expect(titleFrom(" \n \n")).toBe("");
  });
});

describe("excerptFrom", () => {
  it("skips the title line", () => {
    expect(excerptFrom("Lesson 1: Cells\n\nThe cell membrane\ncontrols   entry.")).toBe("The cell membrane controls entry.");
  });
  it("uses the whole text when it is a single line, cut to the limit", () => {
    expect(excerptFrom("One long paragraph only.", 8)).toBe("One long");
  });
});

describe("library store", () => {
  it("saves a recording and reads back its metadata, text and audio", async () => {
    const saved = await saveRecording(recording());
    expect(saved.title).toBe("Lesson 1: Cells");
    expect(saved.position).toBe(0);
    expect(saved.bookmarks).toEqual([]);

    const items = await listItems();
    expect(items.map((i) => i.id)).toEqual([saved.id]);
    // The list holds no text or audio, only a short excerpt.
    expect(Object.keys(items[0])).not.toContain("timeline");
    expect(items[0].excerpt).toBe("The cell membrane controls what enters and leaves.");

    const { item, timeline, audio } = await loadRecording(saved.id);
    expect(item).toEqual(saved);
    expect(timeline).toEqual(TIMELINE);
    expect([...new Uint8Array(await audio.arrayBuffer())]).toEqual([0xff, 0xf3, 1, 2]);
  });

  it("updates position, title and bookmarks; a function patch sees the stored item", async () => {
    const { id } = await saveRecording(recording());
    await updateItem(id, { position: 42.5, lastPlayedAt: 1000 });
    await updateItem(id, { title: "Biology – week 1" });
    const bookmark = { id: "b1", time: 3, from: 0, excerpt: "Lesson 1: Cells", note: "", createdAt: 1 };
    await updateItem(id, (item) => ({ bookmarks: [...item.bookmarks, bookmark] }));
    await updateItem(id, (item) => ({ bookmarks: [...item.bookmarks, { ...bookmark, id: "b2" }] }));
    const item = (await getItem(id))!;
    expect(item.position).toBe(42.5);
    expect(item.title).toBe("Biology – week 1");
    expect(item.bookmarks.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("reports a missing item", async () => {
    await expect(updateItem("nope", { title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(loadRecording("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getItem("nope")).toBeNull();
  });

  it("deletes text, audio and metadata together", async () => {
    const a = await saveRecording(recording());
    const b = await saveRecording(recording("Second recording"));
    await deleteItem(a.id);
    expect((await listItems()).map((i) => i.id)).toEqual([b.id]);
    await expect(loadRecording(a.id)).rejects.toBeInstanceOf(LibraryError);
  });

  it("notifies subscribers after each change", async () => {
    const listener = vi.fn();
    const off = subscribe(listener);
    const { id } = await saveRecording(recording());
    await updateItem(id, { position: 1 });
    await deleteItem(id);
    off();
    await saveRecording(recording());
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("explains when the browser offers no storage", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulating a browser without IndexedDB
    delete globalThis.indexedDB;
    resetConnection();
    await expect(listItems()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    globalThis.indexedDB = original;
  });

  it("orders by the most recent listen or save", () => {
    const item = (id: string, createdAt: number, lastPlayedAt: number | null) => ({ id, createdAt, lastPlayedAt }) as LibraryItem;
    const sorted = sortItems([item("old-unplayed", 10, null), item("old-played-now", 5, 100), item("new", 50, null)]);
    expect(sorted.map((i) => i.id)).toEqual(["old-played-now", "new", "old-unplayed"]);
  });
});
