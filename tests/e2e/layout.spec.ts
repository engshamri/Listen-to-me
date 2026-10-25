import { expect, test } from "@playwright/test";
import { editor, generateButton, noHorizontalOverflow, openFresh } from "./helpers";

const LONG_TEXT = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}: هذا نص طويل جداً يحتوي على كلمات كثيرة لاختبار لصق النصوص الطويلة. This is long pasted text.`).join("\n\n");

test("pasting very long text keeps the editor bounded and the layout stable (desktop)", async ({ page }) => {
  await openFresh(page);
  const before = await generateButton(page).boundingBox();
  await editor(page).fill(LONG_TEXT);
  const box = (await editor(page).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(900 * 0.75 + 1);
  // The textarea scrolls internally instead of growing.
  const scroll = await editor(page).evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(scroll.sh).toBeGreaterThan(scroll.ch * 5);
  const after = await generateButton(page).boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(120); // only the stats/notice rows may change
  await noHorizontalOverflow(page);
  await expect(page.getByText(/characters · .* words/)).toBeVisible();
  await expect(page.getByText(/parts/).first()).toBeVisible();
});

test("the old long voice list is gone: the page shows the selected voice, favorites and a browse button", async ({ page }) => {
  await openFresh(page);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Current voice" })).toBeVisible();
  const optionsOnPage = await page.locator('[role="option"], button[aria-label^="Use "]').count();
  expect(optionsOnPage).toBe(0);
});

test("task order matches keyboard order: text → voice → settings → generate", async ({ page }) => {
  await openFresh(page);
  const positions = await page.evaluate(() => {
    const els = [document.getElementById("text-title"), document.getElementById("voice-title"), document.getElementById("settings-title"), document.querySelector('section[aria-label="Generate audio"]')];
    return els.map((el, i) => (i === 0 ? true : !!(els[i - 1]!.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING)));
  });
  expect(positions).toEqual([true, true, true, true]);
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("compact header, sticky generate bar, voice drawer, no horizontal scroll", async ({ page }) => {
    await openFresh(page);
    // The editor starts within the first screen (no oversized hero).
    const editorBox = (await editor(page).boundingBox())!;
    expect(editorBox.y).toBeLessThan(844 * 0.5);
    // Generate action is reachable without scrolling.
    const gen = (await generateButton(page).boundingBox())!;
    expect(gen.y + gen.height).toBeLessThanOrEqual(844);
    await noHorizontalOverflow(page);

    await editor(page).fill(LONG_TEXT);
    const genAfter = (await generateButton(page).boundingBox())!;
    expect(genAfter.y + genAfter.height).toBeLessThanOrEqual(844);
    await noHorizontalOverflow(page);

    await page.getByRole("button", { name: "Browse all voices" }).click();
    const dlg = page.getByRole("dialog", { name: "Choose a voice" });
    await expect(dlg).toBeVisible();
    await dlg.getByRole("searchbox").fill("salma");
    await dlg.getByRole("button", { name: /^Use Salma\. Arabic · Egypt/ }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole("group", { name: "Current voice" })).toContainText("Arabic · Egypt accent");
  });
});
