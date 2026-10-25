import { expect, test } from "@playwright/test";
import { LIVE, browser, noHorizontalOverflow, openBrowser, openFresh, pickVoice } from "./helpers";

test("hierarchical browsing: language group → country flags → voices, with back navigation", async ({ page }) => {
  await openFresh(page);
  const dlg = await openBrowser(page);

  await dlg.getByRole("button", { name: "All voices" }).click();
  await expect(dlg.getByRole("heading", { name: "All voices" })).toBeVisible();
  for (const name of ["Favorites", "Arabic", "English", "European languages", "Asian languages", "African languages", "Other languages"]) {
    await expect(dlg.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  }

  await dlg.getByRole("button", { name: /^Arabic/ }).click();
  await expect(dlg.getByRole("heading", { name: "Arabic", exact: true })).toBeVisible();
  // 16 Arabic-speaking countries, each a flag card with an SVG flag.
  const countryCards = dlg.locator('li button:has(img[src^="/flags/"])');
  await expect(countryCards).toHaveCount(16);
  for (const region of ["Gulf", "Levant", "Iraq", "Egypt", "Maghreb", "Yemen"]) await expect(dlg.getByRole("region", { name: region })).toBeVisible();
  // Multilingual voices appear here only because their Arabic passed the speech-recognition test.
  const multi = dlg.getByRole("region", { name: "Multilingual voices that also read Arabic" });
  await expect(multi.getByRole("button", { name: /^Use / })).toHaveCount(12);

  await dlg.getByRole("button", { name: /^Iraq/ }).click();
  await expect(dlg.getByRole("heading", { name: "Iraq" })).toBeVisible();
  const cards = dlg.getByRole("button", { name: /^Use / });
  await expect(cards).toHaveCount(2);
  await expect(dlg.getByText("Arabic · Iraq accent").first()).toBeVisible();

  // Breadcrumb shows where we are; Back returns to the country list.
  const crumbs = dlg.getByRole("navigation", { name: "Voice browser location" });
  await expect(crumbs.getByText("Iraq")).toHaveAttribute("aria-current", "page");
  await dlg.getByRole("button", { name: "Back" }).click();
  await expect(dlg.getByRole("heading", { name: "Arabic", exact: true })).toBeVisible();

  // Select a voice; the browser closes and the choice shows on the page.
  await dlg.getByRole("button", { name: /^Egypt/ }).click();
  await dlg.getByRole("button", { name: /^Use Salma\./ }).click();
  await expect(browser(page)).toBeHidden();
  await expect(page.getByRole("group", { name: "Current voice" })).toContainText("Salma");

  // Re-opening returns to the same place, with the selection marked.
  await openBrowser(page);
  await expect(dlg.getByRole("heading", { name: "Egypt" })).toBeVisible();
  await expect(dlg.getByRole("button", { name: /^Use Salma\./ })).toHaveAttribute("aria-pressed", "true");
});

test("audit verdicts reach the UI: clarity badges, disabled voices hidden, repaired voices present", async ({ page }) => {
  await openFresh(page);
  const dlg = await openBrowser(page);
  await dlg.getByRole("searchbox").fill("rana");
  await expect(dlg.getByRole("listitem").filter({ hasText: "Rana" }).getByText("Clarity verified")).toBeVisible();
  await dlg.getByRole("searchbox").fill("christel");
  await expect(dlg.getByText("No voices match your search.")).toBeVisible(); // disabled: failed reliability tests
  await dlg.getByRole("searchbox").fill("inuktitut");
  await expect(dlg.getByRole("button", { name: /^Use / })).toHaveCount(4); // repaired
});

test("search spans the whole library and tolerates Arabic spelling variants", async ({ page }) => {
  await openFresh(page);
  const dlg = await openBrowser(page);
  const search = dlg.getByRole("searchbox");

  await search.fill("اماني");
  await expect(dlg.getByRole("button", { name: /^Use / })).toHaveCount(1);
  await expect(dlg.getByRole("button", { name: /^Use Amany\./ })).toBeVisible();

  await search.fill("عراقي");
  await expect(dlg.getByRole("button", { name: /^Use / })).toHaveCount(2);

  await search.fill("japanese");
  await expect(dlg.getByRole("heading", { name: "Search results" })).toBeVisible();
  expect(await dlg.getByRole("button", { name: /^Use / }).count()).toBeGreaterThan(1);

  await search.fill("zzzz-no-such-voice");
  await expect(dlg.getByText("No voices match your search.")).toBeVisible();
});

test("filters narrow country lists and voice cards", async ({ page }) => {
  await openFresh(page);
  const dlg = await openBrowser(page);
  await dlg.getByRole("button", { name: "All voices" }).click();
  await dlg.getByRole("button", { name: /^Arabic/ }).click();
  await dlg.getByRole("button", { name: /^Saudi Arabia/ }).click();
  await expect(dlg.getByRole("button", { name: /^Use / })).toHaveCount(2);
  await dlg.getByRole("group", { name: "Gender" }).getByRole("button", { name: "Male", exact: true }).click();
  await expect(dlg.getByRole("button", { name: /^Use / })).toHaveCount(1);
  await dlg.getByRole("button", { name: "Multilingual", exact: true }).click();
  await expect(dlg.getByText("No voices match these filters.")).toBeVisible();
  await dlg.getByRole("button", { name: "Clear filters" }).click();
  await expect(dlg.getByRole("button", { name: /^Use / })).toHaveCount(2);
});

test("favorites: add from a card, see them in Favorites and on the page, persist after reload, remove", async ({ page }) => {
  await openFresh(page);
  await expect(page.getByText("Tap the heart on a voice to save it for quick access.")).toBeVisible();
  const dlg = await openBrowser(page);
  await dlg.getByRole("searchbox").fill("rana");
  const heart = dlg.getByRole("button", { name: "Add Rana to favorites" });
  await heart.click();
  await expect(dlg.getByRole("button", { name: "Remove Rana from favorites" })).toHaveAttribute("aria-pressed", "true");
  await dlg.getByRole("searchbox").fill("");

  await dlg.getByRole("button", { name: "All voices" }).click();
  await expect(dlg.getByRole("button", { name: /^Favorites/ })).toContainText("1 voice");
  await dlg.getByRole("button", { name: /^Favorites/ }).click();
  await expect(dlg.getByRole("button", { name: /^Use Rana\./ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Quick-select chip on the main page.
  const chip = page.getByRole("button", { name: "Rana", exact: true });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole("group", { name: "Current voice" })).toContainText("Rana");

  await page.reload();
  await expect(page.getByRole("button", { name: "Rana", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Current voice" }).getByRole("button", { name: "Remove Rana from favorites" }).click();
  await expect(page.getByRole("button", { name: "Rana", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Tap the heart on a voice to save it for quick access.")).toBeVisible();
});

test("favorites work in Arabic too", async ({ page }) => {
  await openFresh(page);
  await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
  await page.goto("/");
  await page.getByRole("button", { name: "تصفّح كل الأصوات" }).click();
  const dlg = page.getByRole("dialog", { name: "اختر صوتاً" });
  await dlg.getByRole("searchbox").fill("رنا");
  await dlg.getByRole("button", { name: "إضافة رنا إلى المفضلة" }).click();
  await expect(dlg.getByRole("button", { name: "إزالة رنا من المفضلة" })).toBeVisible();
  await expect(dlg.getByText("العربية · لكنة العراق").first()).toBeVisible();
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("the voice browser is full-screen and usable on a phone", async ({ page }) => {
    await openFresh(page);
    const dlg = await openBrowser(page);
    // Measured after the short open animation has finished.
    await expect.poll(async () => (await dlg.boundingBox())!.width).toBeGreaterThanOrEqual(388);
    expect((await dlg.boundingBox())!.height).toBeGreaterThanOrEqual(800);
    await dlg.getByRole("button", { name: "All voices" }).click();
    await dlg.getByRole("button", { name: /^English/ }).click();
    await dlg.getByRole("button", { name: /^United Kingdom/ }).click();
    expect(await dlg.getByRole("button", { name: /^Use / }).count()).toBeGreaterThan(2);
    await noHorizontalOverflow(page);
  });
});

test("voice preview plays one at a time and can be stopped", async ({ page }) => {
  test.skip(!LIVE, "needs internet");
  await openFresh(page);
  await pickVoice(page, "hamed", "Hamed");
  const current = page.getByRole("group", { name: "Current voice" });
  await current.getByRole("button", { name: "Preview Hamed" }).click();
  await expect(current.getByRole("button", { name: "Stop preview of Hamed" })).toBeVisible({ timeout: 30_000 });
  await current.getByRole("button", { name: "Stop preview of Hamed" }).click();
  await expect(current.getByRole("button", { name: "Preview Hamed" })).toBeVisible();
});
