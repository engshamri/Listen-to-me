import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { editor, generateButton, openFresh, stubSpeech } from "./helpers";

/* Chapters: choosing which to convert, and jumping between them in reading mode. */

const TEXT = "Lesson 1: Cells\n\nCells are small.\n\nLesson 2: Energy\n\nEnergy flows.\n\nLesson 3: Water\n\nWater moves.";
const WORDS: [string, number][] = [
  ["Lesson", 0.1], ["1", 0.4], ["Cells", 0.6], ["Cells", 1.0], ["are", 1.3], ["small", 1.5],
  ["Lesson", 2.0], ["2", 2.3], ["Energy", 2.5], ["Energy", 2.9], ["flows", 3.3],
  ["Lesson", 4.0], ["3", 4.3], ["Water", 4.5], ["Water", 4.9], ["moves", 5.3],
];

/** Records the text of every speech request. */
function spokenTexts(page: Page): string[] {
  const texts: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/tts")) texts.push((JSON.parse(r.postData() ?? "{}") as { text: string }).text);
  });
  return texts;
}

async function generate(page: Page) {
  await generateButton(page).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await page.locator("audio").evaluate((a: HTMLAudioElement) => (a.readyState >= 1 ? null : new Promise((r) => a.addEventListener("loadedmetadata", r, { once: true }))));
}

test("choose chapters: only those are converted, in order", async ({ page }) => {
  await stubSpeech(page, WORDS);
  const spoken = spokenTexts(page);
  await openFresh(page);
  await editor(page).fill(TEXT);
  await expect(page.getByText("3 chapters found")).toBeVisible();

  await page.getByRole("button", { name: "Choose chapters" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose chapters" });
  await expect(dialog.getByRole("checkbox")).toHaveCount(3);
  await expect(dialog.getByRole("checkbox", { name: /Lesson 2: Energy/ })).toBeChecked();
  await dialog.getByRole("checkbox", { name: /Lesson 2: Energy/ }).uncheck();
  await dialog.getByRole("button", { name: "Convert 2 chapters" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Chapters to convert: 2 of 3")).toBeVisible();

  await generate(page);
  expect(spoken.join("\n")).toContain("Lesson 1: Cells");
  expect(spoken.join("\n")).toContain("Lesson 3: Water");
  expect(spoken.join("\n")).not.toContain("Energy");
  const readAlong = page.getByRole("region", { name: "Text being read" }).first();
  await expect(readAlong).toContainText("Lesson 3: Water");
  await expect(readAlong).not.toContainText("Energy");
});

test("selecting none is not allowed; Use all and editing the text reset the choice", async ({ page }) => {
  await openFresh(page);
  await editor(page).fill(TEXT);
  await page.getByRole("button", { name: "Choose chapters" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose chapters" });
  await dialog.getByRole("button", { name: "Clear" }).click();
  await expect(dialog.getByRole("button", { name: /^Convert/ })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /Lesson 1/ }).check();
  await dialog.getByRole("button", { name: "Convert 1 chapter" }).click();
  await expect(page.getByText("Chapters to convert: 1 of 3")).toBeVisible();

  await page.getByRole("button", { name: "Use all chapters" }).click();
  await expect(page.getByText("3 chapters found")).toBeVisible();

  await page.getByRole("button", { name: "Choose chapters" }).click();
  await dialog.getByRole("checkbox", { name: /Lesson 1/ }).uncheck();
  await dialog.getByRole("button", { name: "Convert 2 chapters" }).click();
  await expect(page.getByText("Chapters to convert: 2 of 3")).toBeVisible();
  await editor(page).press("End");
  await editor(page).pressSequentially(" More.");
  await expect(page.getByText("3 chapters found")).toBeVisible();
});

test("reading mode lists chapters with their times and jumps to them", async ({ page }) => {
  await stubSpeech(page, WORDS);
  await openFresh(page);
  await editor(page).fill(TEXT);
  await generate(page);
  await page.getByRole("button", { name: "Full screen" }).click();
  const dialog = page.getByRole("dialog", { name: "Read along" });
  await dialog.getByRole("button", { name: "Chapters" }).click();
  const list = page.getByRole("navigation", { name: "Chapters" });
  await expect(list.getByRole("button")).toHaveText(["Lesson 1: Cells0:00", "Lesson 2: Energy0:02", "Lesson 3: Water0:04"]);
  await list.getByRole("button", { name: /Lesson 3: Water/ }).click();
  await expect(list).toBeHidden();
  await expect.poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThanOrEqual(3.95);
  await expect(dialog.getByText("Chapter: Lesson 3: Water")).toBeVisible();
  await dialog.getByRole("button", { name: "Chapters" }).click();
  await expect(list.getByRole("button", { name: /Lesson 3: Water/ })).toHaveAttribute("aria-current", "true");
});

test("Arabic chapters", async ({ page }) => {
  await openFresh(page);
  await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
  await page.goto("/");
  await page.locator("#editor").fill("الدرس الأول: الخلية\n\nالخلية صغيرة.\n\nالدرس الثاني: الطاقة\n\nالطاقة تنتقل.\n\nالدرس الثالث: الماء\n\nالماء يتحرك.");
  await expect(page.getByText("عُثر على 3 فصول")).toBeVisible();
  await page.getByRole("button", { name: "اختيار الفصول" }).click();
  const dialog = page.getByRole("dialog", { name: "اختيار الفصول" });
  await expect(dialog.getByRole("checkbox", { name: /الدرس الثاني: الطاقة/ })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "تحويل 3 فصول" })).toBeVisible();
});

test("no accessibility violations in the chapter picker and the chapter list", async ({ page }) => {
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.nodes.length})`), label).toEqual([]);
  };
  await stubSpeech(page, WORDS);
  await openFresh(page);
  await editor(page).fill(TEXT);
  await scan("chapters summary");
  await page.getByRole("button", { name: "Choose chapters" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  await scan("picker");
  await page.keyboard.press("Escape");
  await generate(page);
  await page.getByRole("button", { name: "Full screen" }).click();
  await page.getByRole("button", { name: "Chapters" }).click();
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible();
  await page.waitForTimeout(300);
  await scan("chapter list");
});
