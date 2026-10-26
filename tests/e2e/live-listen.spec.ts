import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { editor, generateButton, openFresh, stubSpeech } from "./helpers";

/*
 * Listening while generating, with a stubbed speech API: every part is the same
 * 6-second MP3; the first answers at once and the others later, so the player
 * has to switch to the longer audio while it plays.
 */

// About 4,000 characters: three parts.
const TEXT = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of the course notes explains one more idea in plain words.`).join(" ") +
  "\n\n" +
  Array.from({ length: 13 }, (_, i) => `Paragraph two, sentence ${i + 1}, keeps going so that the text needs three parts.`).join(" ");

/** The live player (hidden; reading mode is its interface). The result panel adds its own player when generation ends. */
const player = (page: Page) => page.locator("audio[hidden]");
const time = (page: Page) => player(page).evaluate((a: HTMLAudioElement) => a.currentTime);
const src = (page: Page) => player(page).evaluate((a: HTMLAudioElement) => a.src);

async function startListening(page: Page) {
  await openFresh(page);
  await editor(page).fill(TEXT);
  await expect(page.getByText("3 parts")).toBeVisible();
  await generateButton(page).click();
  await page.getByRole("button", { name: "Listen now" }).click();
  const dialog = page.getByRole("dialog", { name: "Read along" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("plays the first part while the rest generate, then continues into the next part", async ({ page }) => {
  await stubSpeech(page, [], (n) => (n === 0 ? 0 : 2500));
  const dialog = await startListening(page);
  await expect(dialog.getByText("Still generating: 1 of 3 parts ready")).toBeVisible();
  await expect.poll(() => time(page)).toBeGreaterThan(0.3);
  await expect(dialog.locator('[data-state="current"]')).toBeVisible();
  // While only part 1 exists, the player holds just that part.
  const firstSource = await src(page);

  // All parts arrive; the status goes away and the full text can be read along.
  await expect(dialog.getByText(/Still generating/)).toBeHidden({ timeout: 15_000 });
  // Near the end of part 1: the player switches to the longer audio and keeps playing into part 2.
  await player(page).evaluate((a: HTMLAudioElement) => {
    a.currentTime = 5.2;
  });
  await expect.poll(() => time(page), { timeout: 10_000 }).toBeGreaterThan(6.5);
  expect(await src(page)).not.toBe(firstSource);
  expect(await player(page).evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
  // The finished result is in the panel behind reading mode.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Your audio" })).toBeVisible();
});

test("when the listener catches up, playback waits and resumes when the next part is ready", async ({ page }) => {
  await stubSpeech(page, [], (n) => (n === 0 ? 0 : 7000));
  const dialog = await startListening(page);
  await expect.poll(() => time(page)).toBeGreaterThan(0.2);
  // Jump close to the end of the only ready part.
  await player(page).evaluate((a: HTMLAudioElement) => {
    a.currentTime = 5.6;
  });
  await expect.poll(() => player(page).evaluate((a: HTMLAudioElement) => a.ended), { timeout: 5000 }).toBe(true);
  await expect(dialog.getByText("Still generating: 1 of 3 parts ready")).toBeVisible();
  // Part 2 arrives: playback continues past the end of part 1.
  await expect.poll(() => time(page), { timeout: 15_000 }).toBeGreaterThan(6.3);
  expect(await player(page).evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
});

test("Listen now appears only for texts of several parts, once the first is ready", async ({ page }) => {
  await stubSpeech(page, [], (n) => (n === 0 ? 1500 : 4000));
  await openFresh(page);
  await editor(page).fill(TEXT);
  await generateButton(page).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Listen now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Listen now" })).toBeVisible({ timeout: 5000 });
});

test("no accessibility violations while listening during generation", async ({ page }) => {
  await stubSpeech(page, [], (n) => (n === 0 ? 0 : 8000));
  await openFresh(page);
  await editor(page).fill(TEXT);
  await generateButton(page).click();
  await expect(page.getByRole("button", { name: "Listen now" })).toBeVisible();
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.nodes.length})`), label).toEqual([]);
  };
  await scan("generate panel with Listen now");
  await page.getByRole("button", { name: "Listen now" }).click();
  await expect(page.getByRole("dialog").getByText(/Still generating/)).toBeVisible();
  await page.waitForTimeout(300);
  await scan("reading mode while generating");
});
