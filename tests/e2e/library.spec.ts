import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_AUDIO, editor, generateButton, noHorizontalOverflow, openFresh, stubSpeech } from "./helpers";

/* The personal library (IndexedDB), with the speech API stubbed by a real 6-second MP3. */

const TITLE = "Lesson 3: Photosynthesis";
const TEXT = `${TITLE}\n\nPlants turn light into chemical energy. Chlorophyll absorbs mostly red and blue light.`;
const WORDS: [string, number][] = [
  ["Lesson", 0.1], ["3", 0.5], ["Photosynthesis", 0.8],
  ["Plants", 1.6], ["turn", 1.9], ["light", 2.1], ["into", 2.4], ["chemical", 2.6], ["energy", 3.0],
  ["Chlorophyll", 3.6], ["absorbs", 4.0], ["mostly", 4.3], ["red", 4.6], ["and", 4.8], ["blue", 5.0], ["light", 5.3],
];
const BOM = "﻿";

async function generate(page: Page, text = TEXT) {
  await editor(page).fill(text);
  await generateButton(page).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
}

async function saveCurrent(page: Page) {
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved to library" })).toBeVisible();
}

async function savedRecording(page: Page, text = TEXT) {
  await stubSpeech(page, WORDS);
  await openFresh(page);
  await generate(page, text);
  await saveCurrent(page);
}

const card = (page: Page, title: string) => page.getByRole("article", { name: title });
const audioTime = (page: Page) => page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime);

test("save a result, listen from the library, and continue where you stopped", async ({ page }) => {
  await savedRecording(page);
  await page.getByRole("link", { name: "Open library" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("heading", { level: 1, name: "My library" })).toBeVisible();

  const item = card(page, TITLE);
  await expect(item).toContainText("Ava");
  await expect(item).toContainText("0:06");
  await expect(item).toContainText("Plants turn light into chemical energy.");

  // Listening opens reading mode with the recording's title.
  await item.getByRole("button", { name: "Listen" }).click();
  const dialog = page.getByRole("dialog", { name: TITLE });
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => !a.paused)).toBe(true);
  await expect(dialog.locator("[data-current]")).toBeVisible();

  // Stop at 3.2 s and close: the position is kept.
  await page.locator("audio").evaluate((a: HTMLAudioElement) => {
    a.pause();
    a.currentTime = 3.2;
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(item.getByRole("button", { name: "Continue" })).toBeVisible();
  await expect(item).toContainText("0:03 of 0:06 listened");
  await expect(item.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "53");

  // The studio offers to continue, from the same place, after a reload.
  await page.goto("/");
  const resume = page.getByRole("region", { name: "Continue listening" });
  await expect(resume).toContainText(TITLE);
  await expect(resume).toContainText("0:03 of 0:06");
  await resume.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: TITLE })).toBeVisible();
  await expect.poll(() => audioTime(page)).toBeGreaterThanOrEqual(3.2);
  expect(await audioTime(page)).toBeLessThan(4.5);
});

test("rename and delete (with confirmation)", async ({ page }) => {
  await savedRecording(page);
  await page.goto("/library");
  await card(page, TITLE).getByRole("button", { name: "Rename" }).click();
  const input = page.getByRole("textbox", { name: "Title" });
  await expect(input).toHaveValue(TITLE);
  await input.fill("Biology – week 3");
  await input.press("Enter");
  await expect(card(page, "Biology – week 3")).toBeVisible();
  await page.reload();
  const renamed = card(page, "Biology – week 3");
  await expect(renamed).toBeVisible();

  await renamed.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this recording?" });
  await expect(confirm).toContainText("“Biology – week 3” will be removed from this browser");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(renamed).toBeVisible();

  await renamed.getByRole("button", { name: "Delete" }).click();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Nothing saved yet.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nothing saved yet.")).toBeVisible();
});

test("exports the audio, the text and subtitles", async ({ page }) => {
  await savedRecording(page);
  await page.goto("/library");
  const item = card(page, TITLE);
  const exportAs = async (name: string) => {
    await item.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name }).click()]);
    return { name: download.suggestedFilename(), body: readFileSync((await download.path())!) };
  };

  const mp3 = await exportAs("Audio (MP3)");
  expect(mp3.name).toMatch(/^listen-to-me_ava[a-z]*_en-US_.*\.mp3$/);
  expect(mp3.body.equals(FIXTURE_AUDIO)).toBe(true);

  const txt = await exportAs("Text (TXT)");
  expect(txt.name).toMatch(/\.txt$/);
  expect(txt.body.toString("utf8")).toBe(BOM + TEXT);

  const srt = await exportAs("Subtitles (SRT)");
  expect(srt.body.toString("utf8")).toContain(`${BOM}1\n00:00:00,100 --> 00:00:01,600\n${TITLE}`);
});

test("new recordings can be saved automatically", async ({ page }) => {
  await stubSpeech(page, WORDS);
  await openFresh(page);
  await page.goto("/library");
  await page.getByRole("switch", { name: "Save new recordings automatically" }).click();
  await page.goto("/");
  await generate(page);
  await expect(page.getByRole("status").filter({ hasText: "Saved to library" })).toBeVisible();
  await page.goto("/library");
  await expect(card(page, TITLE)).toBeVisible();
  await expect(page.getByText("1 recording", { exact: true })).toBeVisible();
});

test("search by title, tolerant of Arabic spelling", async ({ page }) => {
  await savedRecording(page);
  await page.goto("/");
  await generate(page, "الدرس الأول: الخلية\n\nالخلية هي وحدة بناء الكائنات الحية.");
  await saveCurrent(page);
  await page.goto("/library");
  await expect(page.getByText("2 recordings", { exact: true })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search by title" });
  await search.fill("photo");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card(page, TITLE)).toBeVisible();
  // "الاول" without hamza still finds "الأول".
  await search.fill("الدرس الاول");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card(page, "الدرس الأول: الخلية")).toBeVisible();
  await search.fill("zzz");
  await expect(page.getByText("No recordings match “zzz”.")).toBeVisible();
});

test("Arabic: right-to-left library", async ({ page }) => {
  await savedRecording(page, "الدرس الأول: الخلية\n\nالخلية هي وحدة بناء الكائنات الحية.");
  await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
  await page.goto("/library");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "مكتبتي" })).toBeVisible();
  const item = card(page, "الدرس الأول: الخلية");
  await expect(item.getByRole("button", { name: "استماع" })).toBeVisible();
  await expect(page.getByText("تسجيل واحد")).toBeVisible();
});

test("no accessibility violations (library, delete dialog, empty state, dark theme)", async ({ page }) => {
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.nodes.length})`), label).toEqual([]);
  };
  await savedRecording(page);
  await scan("result saved");
  await page.goto("/library");
  await expect(card(page, TITLE)).toBeVisible();
  await scan("library");
  await card(page, TITLE).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  await scan("delete dialog");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.context().addCookies([{ name: "theme", value: "midnight", url: "http://127.0.0.1" }]);
  await page.goto("/library");
  await expect(card(page, TITLE)).toBeVisible();
  await scan("library/midnight");
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Continue listening" })).toHaveCount(0);
  await page.evaluate(
    () =>
      new Promise((done) => {
        const req = indexedDB.deleteDatabase("asmani-library");
        req.onsuccess = req.onerror = req.onblocked = () => done(null);
      }),
  );
  await page.goto("/library");
  await expect(page.getByText("Nothing saved yet.")).toBeVisible();
  await scan("empty/midnight");
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("library and the header fit a phone", async ({ page }) => {
    await savedRecording(page);
    await noHorizontalOverflow(page);
    await page.getByRole("link", { name: "My library" }).first().click();
    await expect(card(page, TITLE)).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
