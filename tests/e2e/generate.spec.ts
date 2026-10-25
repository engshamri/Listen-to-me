import { expect, test } from "@playwright/test";
import { LIVE, editor, generateButton, openFresh, pickVoice } from "./helpers";

test.skip(!LIVE, "needs internet and the speech engine");

test("generates Arabic audio; replay reuses the single player (no extra Audio objects)", async ({ page }) => {
  // Count every Audio/<audio> created, to prove replay doesn't spawn new players.
  await page.addInitScript(() => {
    const w = window as unknown as { __audioCreated: number; Audio: typeof Audio };
    w.__audioCreated = 0;
    const Original = w.Audio;
    w.Audio = function (...args: ConstructorParameters<typeof Audio>) {
      w.__audioCreated++;
      return new Original(...args);
    } as unknown as typeof Audio;
  });
  await openFresh(page);
  await pickVoice(page, "rana", "Rana");
  await editor(page).fill("مرحباً بكم في اسمعني. هذا اختبار قصير للصوت العربي.");
  await generateButton(page).click();

  const result = page.getByRole("region", { name: "Your audio" });
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(result.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expect(result.getByRole("link", { name: "Download MP3" })).toHaveAttribute("download", /^listen-to-me_rana_ar-IQ_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp3$/);
  await expect(result.getByText("Complete")).toBeVisible();
  await expect(result.getByText(/^0:0[2-9]$|^0:[1-5]\d$/)).toBeVisible(); // measured duration

  const created = await page.evaluate(() => (window as unknown as { __audioCreated: number }).__audioCreated);
  for (let i = 0; i < 3; i++) await result.getByRole("button", { name: "Play from the start" }).click();
  expect(await page.evaluate(() => (window as unknown as { __audioCreated: number }).__audioCreated)).toBe(created);
  expect(await page.locator("audio").count()).toBe(1);
  await expect.poll(() => result.locator("audio").evaluate((a: HTMLAudioElement) => !a.paused)).toBe(true);
});

test("long text is generated in parts with determinate progress", async ({ page }) => {
  await openFresh(page);
  await pickVoice(page, "en-US-Guy", "Guy");
  const sentence = "This is a sentence used to build a long document for testing. ";
  await editor(page).fill(Array.from({ length: 6 }, () => sentence.repeat(9)).join("\n\n"));
  await generateButton(page).click();
  await expect(page.getByRole("status").filter({ hasText: /Part \d+ of \d+/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("progressbar", { name: "Generating audio…" })).toHaveAttribute("aria-valuenow", /\d+/);
  const result = page.getByRole("region", { name: "Your audio" });
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result.getByText("Complete")).toBeVisible();
});

test("cancel stops generation and produces no result", async ({ page }) => {
  await openFresh(page);
  await editor(page).fill("A long text that will be cancelled before it finishes. ".repeat(400));
  await generateButton(page).click();
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByText("Generation cancelled")).toBeVisible();
  await expect(generateButton(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Your audio" })).toHaveCount(0);
});

test("empty text explains instead of failing", async ({ page }) => {
  await openFresh(page);
  await expect(page.locator("#generate-reason")).toHaveText("Add some text first.");
  await expect(generateButton(page)).toHaveAttribute("aria-disabled", "true");
  // aria-disabled (not disabled) keeps it focusable and clickable so it can explain itself.
  await generateButton(page).click({ force: true });
  await expect(editor(page)).toBeFocused();
});
