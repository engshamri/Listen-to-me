import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { editor, generateButton, openFresh, stubSpeech } from "./helpers";

/* Bookmarks and notes in reading mode, kept in the library. */

const TITLE = "Lesson 3: Photosynthesis";
const TEXT = `${TITLE}\n\nPlants turn light into chemical energy. Chlorophyll absorbs mostly red and blue light.`;
const SENTENCE = "Plants turn light into chemical energy.";
const WORDS: [string, number][] = [
  ["Lesson", 0.1], ["3", 0.5], ["Photosynthesis", 0.8],
  ["Plants", 1.6], ["turn", 1.9], ["light", 2.1], ["into", 2.4], ["chemical", 2.6], ["energy", 3.0],
  ["Chlorophyll", 3.6], ["absorbs", 4.0], ["mostly", 4.3], ["red", 4.6], ["and", 4.8], ["blue", 5.0], ["light", 5.3],
];

async function openReading(page: Page) {
  await stubSpeech(page, WORDS);
  await openFresh(page);
  await editor(page).fill(TEXT);
  await generateButton(page).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await page.locator("audio").evaluate((a: HTMLAudioElement) => (a.readyState >= 1 ? null : new Promise((r) => a.addEventListener("loadedmetadata", r, { once: true }))));
  await page.getByRole("button", { name: "Full screen" }).click();
  const dialog = page.getByRole("dialog", { name: "Read along" });
  await expect(dialog).toBeVisible();
  // In the second sentence (1.6 s – 3.6 s).
  await page.locator("audio").evaluate(
    (a: HTMLAudioElement) =>
      new Promise<void>((resolve) => {
        a.addEventListener("seeked", () => resolve(), { once: true });
        a.currentTime = 2.5;
      }),
  );
  await expect(dialog.locator('[data-state="current"]')).toHaveText(SENTENCE);
  return dialog;
}

const list = (page: Page) => page.getByRole("region", { name: "Bookmarks" });

test("bookmark a sentence with B, add a note; the recording is saved to the library", async ({ page }) => {
  const dialog = await openReading(page);
  await dialog.getByRole("region", { name: "Text being read" }).focus();
  await page.keyboard.press("b");
  // Announced in a status line (a toast would cover the header controls on phones).
  await expect(dialog.getByRole("status")).toHaveText("Bookmark added (0:02)");
  await expect(page.getByText("Bookmarks are kept in My library, so this recording was saved there.")).toBeVisible();
  // Marking the same sentence again keeps a single bookmark.
  await dialog.getByRole("button", { name: "Bookmark this sentence" }).click();

  await dialog.getByRole("button", { name: "Bookmarks: 1 bookmark" }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await expect(list(page).getByRole("listitem")).toContainText(SENTENCE);
  const note = list(page).getByRole("textbox", { name: "Note for the bookmark at 0:02" });
  // Typing "b" in a note must not add a bookmark.
  await note.fill("Remember: chlorophyll is why leaves are green.");
  await note.press("b");
  await note.press("Backspace");
  await note.blur();
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(list(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Saved to library" })).toBeVisible();

  // In the library: count, note kept, jump, remove.
  await page.goto("/library");
  const card = page.getByRole("article", { name: TITLE });
  await expect(card).toContainText("1 bookmark");
  await card.getByRole("button", { name: "Listen" }).click();
  const player = page.getByRole("dialog", { name: TITLE });
  await player.getByRole("button", { name: "Bookmarks: 1 bookmark" }).click();
  await expect(list(page).getByRole("textbox")).toHaveValue("Remember: chlorophyll is why leaves are green.");
  await list(page).getByRole("button", { name: "Play from 0:02" }).click();
  await expect.poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThanOrEqual(1.55);
  await player.getByRole("button", { name: "Bookmarks: 1 bookmark" }).click();
  await list(page).getByRole("button", { name: "Remove the bookmark at 0:02" }).click();
  await expect(list(page)).toContainText("No bookmarks yet.");
  await expect(player.getByRole("button", { name: "Bookmarks: 0 bookmarks" })).toBeVisible();
});

test("bookmarks and notes export as Markdown", async ({ page }) => {
  const dialog = await openReading(page);
  await dialog.getByRole("button", { name: "Bookmark this sentence" }).click();
  await dialog.getByRole("button", { name: "Bookmarks: 1 bookmark" }).click();
  const note = list(page).getByRole("textbox");
  await note.fill("Key idea for the exam.");
  await note.blur();
  const [fromReading] = await Promise.all([page.waitForEvent("download"), list(page).getByRole("button", { name: "Export notes (Markdown)" }).click()]);
  expect(fromReading.suggestedFilename()).toMatch(/\.md$/);
  const md = readFileSync((await fromReading.path())!, "utf8");
  expect(md).toContain(`# ${TITLE}\n\n`);
  expect(md).toContain(`## Bookmarks\n\n### 0:02\n\n> ${SENTENCE}\n\nKey idea for the exam.\n`);

  await page.keyboard.press("Escape");
  await expect(list(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.goto("/library");
  const card = page.getByRole("article", { name: TITLE });
  await card.getByRole("button", { name: "Export" }).click();
  const [fromLibrary] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Bookmarks and notes (Markdown)" }).click()]);
  expect(readFileSync((await fromLibrary.path())!, "utf8")).toBe(md);
});

test("Arabic: bookmark controls are translated", async ({ page }) => {
  await stubSpeech(page, WORDS);
  await openFresh(page);
  await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
  await page.goto("/");
  await page.locator("#editor").fill(TEXT);
  await page.getByRole("button", { name: "توليد الصوت", exact: true }).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "ملء الشاشة" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "إضافة علامة مرجعية لهذه الجملة" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/^أُضيفت العلامة المرجعية/);
  await expect(dialog.getByRole("button", { name: "العلامات المرجعية: علامة مرجعية واحدة" })).toBeVisible();
});

test("no accessibility violations in the bookmarks list (light and dark)", async ({ page }) => {
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.nodes.length})`), label).toEqual([]);
  };
  const dialog = await openReading(page);
  await dialog.getByRole("button", { name: /^Bookmarks:/ }).click();
  await expect(list(page)).toContainText("No bookmarks yet.");
  await page.waitForTimeout(300);
  await scan("empty list");
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Bookmark this sentence" }).click();
  await dialog.getByRole("button", { name: "Bookmarks: 1 bookmark" }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await page.waitForTimeout(300);
  await scan("one bookmark/light");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "midnight"));
  await page.waitForTimeout(400);
  await scan("one bookmark/midnight");
});
