import { expect, type Page } from "@playwright/test";

export const editor = (page: Page) => page.getByRole("textbox", { name: "Text to read aloud" });
export const generateButton = (page: Page) => page.getByRole("button", { name: "Generate audio", exact: true });
export const browser = (page: Page) => page.getByRole("dialog", { name: "Choose a voice" });

/** Fresh page with no saved draft/settings/favorites, English UI, and the app hydrated. */
export async function openFresh(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Browse all voices" })).toBeVisible();
}

export async function openBrowser(page: Page) {
  await page.getByRole("button", { name: "Browse all voices" }).click();
  await expect(browser(page)).toBeVisible();
  return browser(page);
}

/** Selects a voice through the browser's search. `name` is the voice's display name. */
export async function pickVoice(page: Page, query: string, name: string) {
  const dlg = await openBrowser(page);
  await dlg.getByRole("searchbox").fill(query);
  await dlg.getByRole("button", { name: new RegExp(`^Use ${name}\\.`) }).first().click();
  await expect(browser(page)).toBeHidden();
  await expect(page.getByRole("group", { name: "Current voice" })).toContainText(name);
}

/**
 * Content must fit the device width. On mobile, an over-wide page makes the
 * browser zoom out (innerWidth grows past the visual viewport), so compare
 * against the visual viewport, not innerWidth.
 */
export async function noHorizontalOverflow(page: Page) {
  const m = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    visual: Math.round(window.visualViewport?.width ?? window.innerWidth),
  }));
  expect(m.inner, "layout viewport wider than device").toBeLessThanOrEqual(m.visual + 1);
  expect(m.scroll - m.inner).toBeLessThanOrEqual(1);
}

export const LIVE = !process.env.OFFLINE;
