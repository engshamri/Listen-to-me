import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { editor, generateButton, noHorizontalOverflow, openFresh } from "./helpers";

/*
 * Read-along with a stubbed speech API: a real 6-second MP3 plus word timings,
 * so highlighting can be checked at exact moments.
 */

const AUDIO = readFileSync(join(__dirname, "..", "fixtures", "silence-6s.mp3"));
const EN_TEXT = "First sentence is here. Second one follows now. Third and last.";
const EN_WORDS: [string, number][] = [
  ["First", 0.2], ["sentence", 0.6], ["is", 1.0], ["here", 1.2],
  ["Second", 2.0], ["one", 2.4], ["follows", 2.7], ["now", 3.1],
  ["Third", 4.0], ["and", 4.4], ["last", 4.7],
];
const AR_TEXT = "مرحباً بكم في اسمعني. هذا اختبار للقراءة المتزامنة.";
const AR_WORDS: [string, number][] = [["مرحباً", 0.2], ["بكم", 0.8], ["في", 1.2], ["اسمعني", 1.5], ["هذا", 2.6], ["اختبار", 3.0], ["للقراءة", 3.6], ["المتزامنة", 4.2]];

async function stubSpeech(page: Page, words: [string, number][]) {
  const boundary = "readalongboundary";
  const json = JSON.stringify(words.map(([text, start]) => ({ text, start, end: start + 0.3 })));
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="speech.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`),
    AUDIO,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="words"\r\n\r\n${json}\r\n--${boundary}--\r\n`),
  ]);
  await page.route("**/api/tts", (route) => route.fulfill({ status: 200, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body }));
}

async function generate(page: Page, text: string) {
  await editor(page).fill(text);
  await generateButton(page).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await page.locator("audio").evaluate((a: HTMLAudioElement) => (a.readyState >= 1 ? null : new Promise((r) => a.addEventListener("loadedmetadata", r, { once: true }))));
}

/** Moves the player to `t` seconds (paused) and waits until the page has caught up. */
async function seek(page: Page, t: number) {
  await page.locator("audio").evaluate(
    (a: HTMLAudioElement, time) =>
      new Promise<void>((resolve) => {
        a.addEventListener("seeked", () => resolve(), { once: true });
        a.currentTime = time;
      }),
    t,
  );
}

const readAlong = (page: Page) => page.getByRole("region", { name: "Text being read" }).first();
const sentence = (page: Page, i: number) => readAlong(page).locator(`[data-sentence="${i}"]`);

test("before playing, the text shows in its normal colour", async ({ page }) => {
  await stubSpeech(page, EN_WORDS);
  await openFresh(page);
  await generate(page, EN_TEXT);
  await expect(readAlong(page)).toContainText(EN_TEXT);
  await expect(readAlong(page).locator("[data-sentence]")).toHaveCount(3);
  await expect(readAlong(page).locator('[data-state="idle"]')).toHaveCount(3);
});

test("boxes the sentence being read, highlights its word, darkens what was read", async ({ page }) => {
  await stubSpeech(page, EN_WORDS);
  await openFresh(page);
  await generate(page, EN_TEXT);

  await seek(page, 2.75);
  const current = readAlong(page).locator('[data-state="current"]');
  await expect(current).toHaveText("Second one follows now.");
  await expect(current).toHaveAttribute("aria-current", "true");
  await expect(current.locator("[data-current]")).toHaveText("follows");
  await expect(sentence(page, 0)).toHaveAttribute("data-state", "read");
  await expect(sentence(page, 2)).toHaveAttribute("data-state", "upcoming");
  // Within the sentence: words already spoken are dark, words still to come are grey.
  await expect(current.locator('[data-word="1"]')).not.toHaveClass(/text-muted-foreground/);
  await expect(current.locator('[data-word="3"]')).toHaveClass(/text-muted-foreground/);

  await seek(page, 4.5);
  await expect(readAlong(page).locator('[data-state="current"]')).toHaveText("Third and last.");
  await expect(readAlong(page).locator("[data-current]")).toHaveText("and");
  await expect(sentence(page, 1)).toHaveAttribute("data-state", "read");
});

test("clicking a sentence plays from its start", async ({ page }) => {
  await stubSpeech(page, EN_WORDS);
  await openFresh(page);
  await generate(page, EN_TEXT);
  await sentence(page, 2).click();
  await expect.poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => !a.paused)).toBe(true);
  const t = await page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime);
  expect(t).toBeGreaterThanOrEqual(3.95);
  expect(t).toBeLessThan(5);
});

test("listening speed changes the player only and is remembered", async ({ page }) => {
  await stubSpeech(page, EN_WORDS);
  await openFresh(page);
  await generate(page, EN_TEXT);
  await page.getByLabel("Listening speed").first().selectOption("1.5");
  expect(await page.locator("audio").evaluate((a: HTMLAudioElement) => a.playbackRate)).toBe(1.5);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("asmani:settings")!).playbackRate)).toBe(1.5);
});

test("the read-along box can be turned off", async ({ page }) => {
  await stubSpeech(page, EN_WORDS);
  await openFresh(page);
  await generate(page, EN_TEXT);
  await page.getByRole("switch", { name: "Highlight while playing" }).click();
  await expect(readAlong(page)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("asmani:settings")!).readAlong)).toBe(false);
});

test("full-screen reading mode: keyboard, controls, text size", async ({ page }) => {
  await stubSpeech(page, EN_WORDS);
  await openFresh(page);
  await generate(page, EN_TEXT);
  await page.getByRole("button", { name: "Full screen" }).click();
  const dialog = page.getByRole("dialog", { name: "Read along" });
  await expect(dialog).toBeVisible();
  const text = dialog.getByRole("region", { name: "Text being read" });
  await text.focus();

  await page.keyboard.press("ArrowRight"); // next sentence: 2.0 s
  await expect.poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThanOrEqual(1.95);
  await expect(dialog.locator('[data-state="current"]')).toHaveText("Second one follows now.");
  await expect(dialog.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press(" ");
  await expect(dialog.getByRole("button", { name: "Play" })).toBeVisible();

  const size = () => text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const before = await size();
  await dialog.getByRole("button", { name: "Larger text" }).click();
  expect(await size()).toBeGreaterThan(before);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("long text: reading mode opens on the sentence being read, far down the page", async ({ page }) => {
  await stubSpeech(page, []);
  await openFresh(page);
  const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i + 1} belongs to a long chapter of course notes.`).join(" ");
  await generate(page, long);
  const duration = await page.locator("audio").evaluate((a: HTMLAudioElement) => a.duration);
  await seek(page, duration * 0.7);
  await page.getByRole("button", { name: "Full screen" }).click();
  const dialog = page.getByRole("dialog", { name: "Read along" });
  // Estimated timings put several sentences in each second, so the box keeps moving.
  await dialog.getByRole("button", { name: "Play" }).click();
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(400);
    await expect(dialog.locator('[data-state="current"]')).toBeInViewport({ timeout: 300 });
  }
});

test("subtitles download as SRT and WebVTT", async ({ page }) => {
  await stubSpeech(page, EN_WORDS);
  await openFresh(page);
  await generate(page, EN_TEXT);
  const [srt] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "SRT subtitles" }).click()]);
  expect(srt.suggestedFilename()).toMatch(/^listen-to-me_.*\.srt$/);
  const srtText = readFileSync((await srt.path())!, "utf8");
  expect(srtText).toContain("1\n00:00:00,200 --> 00:00:02,000\nFirst sentence is here.");
  const [vtt] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "WebVTT subtitles" }).click()]);
  expect(readFileSync((await vtt.path())!, "utf8").startsWith("WEBVTT\n\n00:00:00.200 --> ")).toBe(true);
});

test("Arabic: right-to-left read-along", async ({ page }) => {
  await stubSpeech(page, AR_WORDS);
  await openFresh(page);
  await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
  await page.goto("/");
  // The editor's label is Arabic here, so find it by id.
  await page.locator("#editor").fill(AR_TEXT);
  await generateButton(page).or(page.getByRole("button", { name: "توليد الصوت", exact: true })).first().click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await page.locator("audio").evaluate((a: HTMLAudioElement) => (a.readyState >= 1 ? null : new Promise((r) => a.addEventListener("loadedmetadata", r, { once: true }))));
  const region = page.getByRole("region", { name: "النص الذي يُقرأ" });
  expect(await region.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  await seek(page, 3.1);
  await expect(region.locator('[data-state="current"]')).toHaveText("هذا اختبار للقراءة المتزامنة.");
  await expect(region.locator("[data-current]")).toHaveText("اختبار");
});

test("no accessibility violations while reading along (light, dark, reading mode)", async ({ page }) => {
  await stubSpeech(page, EN_WORDS);
  await openFresh(page);
  await generate(page, EN_TEXT);
  await seek(page, 2.75);
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.nodes.length})`), label).toEqual([]);
  };
  await scan("panel/light");
  await page.getByRole("button", { name: "Full screen" }).click();
  await expect(page.getByRole("dialog", { name: "Read along" })).toBeVisible();
  await page.waitForTimeout(300);
  await scan("reading mode/light");
  await page.keyboard.press("Escape");
  await page.context().addCookies([{ name: "theme", value: "midnight", url: "http://127.0.0.1" }]);
  await page.goto("/");
  await generate(page, EN_TEXT);
  await seek(page, 2.75);
  await scan("panel/midnight");
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("read-along and reading mode fit the screen", async ({ page }) => {
    await stubSpeech(page, EN_WORDS);
    await openFresh(page);
    await generate(page, EN_TEXT);
    await seek(page, 2.75);
    await noHorizontalOverflow(page);
    await page.getByRole("button", { name: "Full screen" }).click();
    const dialog = page.getByRole("dialog", { name: "Read along" });
    await expect(dialog.getByRole("button", { name: "Next sentence" })).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
  });
});
