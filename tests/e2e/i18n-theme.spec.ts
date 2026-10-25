import { expect, test } from "@playwright/test";
import { openFresh } from "./helpers";

test("English is the default; Arabic switches to RTL, persists, and renders server-side", async ({ page }) => {
  await openFresh(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Text to speech");

  await page.getByRole("button", { name: "Interface language" }).click();
  await page.getByRole("menuitemradio", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("تحويل النص إلى كلام");
  await expect(page).toHaveTitle(/اسمعني/);

  // Radix sliders follow the interface direction.
  await expect(page.locator('[data-slot="slider"]').first()).toHaveAttribute("dir", "rtl");

  // An empty editor follows the interface (an empty dir="auto" field is LTR and
  // scrambles the Arabic placeholder); typed text then sets its own direction.
  const editor = page.locator("#editor");
  await expect(editor).toHaveAttribute("dir", "rtl");
  await editor.fill("Hello world");
  await expect(editor).toHaveAttribute("dir", "auto");
  expect(await editor.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  await editor.fill("");

  // The server renders Arabic on the very first byte (no flash of English/LTR).
  const html = await (await page.request.get("/")).text();
  expect(html).toMatch(/<html[^>]*lang="ar"[^>]*dir="rtl"/);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("تحويل النص إلى كلام");
});

test("theme gallery: 18 themes + System, live preview on hover, revert on close, choice persists without flash", async ({ page }) => {
  await openFresh(page);
  await page.getByRole("button", { name: "Theme" }).click();
  const gallery = page.getByRole("dialog");
  await expect(gallery.getByRole("heading", { name: "Theme" })).toBeVisible();
  await expect(gallery.getByRole("button", { pressed: true })).toHaveCount(1);
  const cards = gallery.locator("button[aria-pressed]");
  await expect(cards).toHaveCount(19);

  // Hovering previews the theme on the whole page without saving it.
  await gallery.getByRole("button", { name: "Mocha" }).hover();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "mocha");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");

  // Selecting keeps it, server-side too.
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Midnight" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  // Re-opening starts on the current theme and doesn't preview a different one.
  await page.getByRole("button", { name: "Theme" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Midnight" })).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page.keyboard.press("Escape");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(11, 16, 32)");
  const html = await (await page.request.get("/")).text();
  expect(html).toMatch(/<html[^>]*data-theme="midnight"/);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
});

test("every theme renders key components with distinct, readable colors", async ({ page }) => {
  await openFresh(page);
  const themes = ["light", "paper", "ocean", "emerald", "arctic", "lavender", "rose", "sunset", "sand", "slate", "midnight", "graphite", "nordic", "purple", "wine", "mocha", "forest", "amoled"];
  for (const id of themes) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), id);
    const c = await page.evaluate(() => {
      const btn = document.querySelector('section[aria-label="Generate audio"] button') as HTMLElement;
      const card = document.querySelector('section[aria-labelledby="text-title"]') as HTMLElement;
      const s = getComputedStyle(btn);
      return { fg: s.color, bg: s.backgroundColor, card: getComputedStyle(card).backgroundColor, page: getComputedStyle(document.body).backgroundColor };
    });
    expect(c.fg, id).not.toBe(c.bg);
    expect(c.bg, id).not.toBe(c.card);
  }
});
