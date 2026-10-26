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

test("the voice section shows the selected voice, favorites and a browse button instead of a full list", async ({ page }) => {
  await openFresh(page);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Current voice" })).toBeVisible();
  const optionsOnPage = await page.locator('[role="option"], button[aria-label^="Use "]').count();
  expect(optionsOnPage).toBe(0);
});

test("footer and About credit the owner and link to Instagram and the source code", async ({ page }) => {
  await openFresh(page);
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText(`© ${new Date().getFullYear()} Yousif AL_Shamri. All rights reserved.`);
  await expect(footer.getByRole("link", { name: "@mmmmn" })).toHaveAttribute("href", "https://www.instagram.com/mmmmn/");
  await expect(footer.getByRole("link", { name: "Source code" })).toHaveAttribute("href", "https://github.com/engshamri/Listen_to_me");
  await footer.getByRole("button", { name: "About", exact: true }).click();
  const about = page.getByRole("dialog", { name: "About Listen to me" });
  await expect(about).toContainText("Yousif AL_Shamri");
  await expect(about.getByRole("link", { name: "Source code on GitHub" })).toHaveAttribute("href", "https://github.com/engshamri/Listen_to_me");
});

test("a recording over the server's conversion limit explains why M4A and MP4 are unavailable", async ({ page }) => {
  // MPEG-2 Layer III frames (24 kHz, 48 kbps, mono), as the speech service sends: about 0.5 s.
  const frame = Buffer.concat([Buffer.from([0xff, 0xf3, 0x64, 0xc4]), Buffer.alloc(140)]);
  const mp3 = Buffer.concat(Array.from({ length: 21 }, () => frame));
  await page.route("**/api/health", (r) => r.fulfill({ json: { converter: true, convertMaxBytes: 1000, translation: "Google Translate", backupVoice: true } }));
  await page.route("**/api/tts", (r) => r.fulfill({ body: mp3, contentType: "audio/mpeg" }));
  await openFresh(page);
  await editor(page).fill("A short sentence.");
  await generateButton(page).click();
  const result = page.getByRole("region", { name: "Your audio" });
  await expect(result).toBeVisible();
  await expect(result.getByRole("button", { name: "M4A audio" })).toBeDisabled();
  await expect(result.getByRole("button", { name: "MP4 video" })).toBeDisabled();
  await expect(result.getByText(/too long to convert on this server/)).toHaveCount(2);
  await expect(result.getByRole("link", { name: "Download MP3" })).toBeVisible();
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
