import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { noHorizontalOverflow, openFresh } from "./helpers";

/*
 * The Back button on secondary pages and the header on phones (names under
 * the icons), in desktop Edge and in WebKit with an iPhone 13 profile.
 */

const back = (page: Page) => page.getByRole("main").getByRole("link", { name: "Back", exact: true });
/** The header tools (named "Main menu" / «القائمة الرئيسية»). */
const header = (page: Page) => page.getByRole("banner").getByRole("navigation");

/** Opens a page in a fresh tab state (no history of this app). */
async function openDirect(page: Page, path: string, locale = "en") {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();
  if (locale !== "en") await page.context().addCookies([{ name: "locale", value: locale, url: "http://127.0.0.1" }]);
  // A new tab: nothing of this app in its history.
  const fresh = await page.context().newPage();
  await page.close();
  await fresh.goto(path);
  return fresh;
}

test("every secondary page has one Back; opened directly, it leads to the parent page", async ({ page }) => {
  for (const [path, parent] of [
    ["/study", "/"],
    ["/library", "/"],
    ["/support", "/"],
    ["/pdf-check", "/"],
    ["/study/review", "/study"],
  ]) {
    page = await openDirect(page, path);
    await expect(back(page), path).toHaveCount(1);
    await expect(back(page)).toHaveAttribute("href", parent);
    await back(page).click();
    await expect(page, `${path} → ${parent}`).toHaveURL(new RegExp(`${parent === "/" ? "/" : parent}$`));
  }
  // The home page has none.
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("link", { name: "Back", exact: true })).toHaveCount(0);
});

test("after moving inside the app, Back returns to the previous page (browser history), with no loop", async ({ page }) => {
  await openFresh(page);
  await header(page).getByRole("link", { name: "My library" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await header(page).getByRole("link", { name: /Support/ }).click();
  await expect(page).toHaveURL(/\/support$/);

  await back(page).click();
  await expect(page).toHaveURL(/\/library$/);
  await back(page).click();
  await expect(page).toHaveURL(/\/$/);
  // Those were real steps back: the browser can go forward again.
  await page.goForward();
  await expect(page).toHaveURL(/\/library$/);

  // Opened directly, then moved on: Back steps back once, then uses the parent page instead of leaving the app.
  page = await openDirect(page, "/support");
  await header(page).getByRole("link", { name: "Study" }).click();
  await expect(page).toHaveURL(/\/study$/);
  await back(page).click();
  await expect(page).toHaveURL(/\/support$/);
  await back(page).click();
  await expect(page).toHaveURL(/\/$/);
});

test("Back works with the keyboard, has a visible focus ring, and a dialog still closes on its own", async ({ page, isMobile }) => {
  test.skip(isMobile, "Keyboard navigation is a desktop check");
  await openFresh(page);
  await header(page).getByRole("link", { name: "My library" }).click();
  await expect(page).toHaveURL(/\/library$/);

  // A dialog closes with Escape and leaves the page where it was.
  await header(page).getByRole("button", { name: "About" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).toHaveURL(/\/library$/);

  await back(page).focus();
  const ring = await back(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return s.outlineStyle !== "none" || s.boxShadow !== "none";
  });
  expect(ring).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
});

test("Arabic: «رجوع» sits at the start of the line on the right, its arrow pointing right", async ({ page }) => {
  page = await openDirect(page, "/library", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const link = page.getByRole("main").getByRole("link", { name: "رجوع", exact: true });
  await expect(link).toBeVisible();
  const [box, main] = await Promise.all([link.boundingBox(), page.getByRole("main").boundingBox()]);
  expect(box!.x + box!.width).toBeGreaterThan(main!.x + main!.width * 0.75);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // Mirrored with the CSS scale property (Tailwind 4): -1 on the x axis.
  expect(await link.locator("svg").evaluate((svg) => `${getComputedStyle(svg).scale} ${getComputedStyle(svg).transform}`)).toMatch(/^-1|matrix\(-1/);
});

/** The six header tools on a phone: names under the icons, in the accessible names, large enough, nothing cut off. */
async function checkPhoneHeader(page: Page, labels: string[]) {
  const items = header(page).locator(":scope > a, :scope > button");
  await expect(items).toHaveCount(6);
  for (const [i, label] of labels.entries()) {
    const item = items.nth(i);
    await expect(item.getByText(label, { exact: true }).filter({ visible: true }), label).toHaveCount(1);
    // The visible name is part of the accessible name (WCAG 2.5.3).
    const name = (await item.getAttribute("aria-label")) ?? "";
    expect(name.toLocaleLowerCase().includes(label.toLocaleLowerCase()), `${label} in “${name}”`).toBe(true);
    const box = (await item.boundingBox())!;
    expect(box.width, `${label} width`).toBeGreaterThanOrEqual(40);
    expect(box.height, `${label} height`).toBeGreaterThanOrEqual(44);
    expect(await item.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${label} not cut off`).toBe(true);
  }
  // The row stays one line: the header is still 56 px tall.
  expect((await page.getByRole("banner").boundingBox())!.height).toBeLessThanOrEqual(57);
  await noHorizontalOverflow(page);
}

const EN = ["Study", "Library", "Language", "Theme", "Support", "About"];
const AR = ["المذاكرة", "مكتبتي", "اللغة", "المظهر", "دعم", "حول"];

test.describe("phone header", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("each icon has its name under it, in English and Arabic, at 390, 360 and 320 px", async ({ page }) => {
    await openFresh(page);
    for (const width of [390, 360, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await checkPhoneHeader(page, EN);
    }
    page = await openDirect(page, "/", "ar");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await checkPhoneHeader(page, AR);
    }
  });

  test("the labelled tools still work: language menu, theme gallery, About, Study", async ({ page }) => {
    await openFresh(page);
    await header(page).getByRole("button", { name: "Language: English" }).click();
    await page.getByRole("menuitemradio", { name: "العربية" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await header(page).getByRole("button", { name: "المظهر" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await header(page).getByRole("button", { name: "حول الموقع" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await header(page).getByRole("link", { name: "المذاكرة" }).click();
    await expect(page).toHaveURL(/\/study$/);
  });

  test("no accessibility violations in the phone header (light and dark, English and Arabic)", async ({ page }) => {
    const scan = async (label: string) => {
      const r = await new AxeBuilder({ page }).include("header").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
    };
    await openFresh(page);
    await scan("light");
    await page.context().addCookies([{ name: "theme", value: "midnight", url: "http://127.0.0.1" }]);
    await page.reload();
    await scan("dark");
    await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
    await page.reload();
    await scan("dark Arabic");
  });
});

test("desktop keeps the compact header: names beside Study and My library only, tooltips on the icons", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop layout");
  await openFresh(page);
  for (const label of ["Theme", "Support", "About"]) await expect(header(page).getByText(label, { exact: true })).toBeHidden();
  await expect(header(page).getByText("My library", { exact: true })).toBeVisible();
  await expect(page.getByRole("banner").getByText("Listen to me", { exact: true })).toBeVisible();
  await header(page).getByRole("button", { name: "About" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("About");
});
