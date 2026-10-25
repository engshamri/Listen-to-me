import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openBrowser, openFresh } from "./helpers";

async function scan(page: Page, label: string) {
  // Dialogs fade and zoom in; a scan during the animation measures half-transparent text.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = results.violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
  if (summary.length) console.log(`[${label}]\n  ${summary.join("\n  ")}`);
  expect(summary, label).toEqual([]);
}

test("no WCAG 2.2 A/AA violations: English, default theme", async ({ page }) => {
  await openFresh(page);
  await scan(page, "en/system");
});

test("no WCAG 2.2 A/AA violations: Arabic RTL, dark theme, with text entered", async ({ page }) => {
  await openFresh(page);
  await page.context().addCookies([
    { name: "locale", value: "ar", url: "http://127.0.0.1" },
    { name: "theme", value: "midnight", url: "http://127.0.0.1" },
  ]);
  await page.goto("/");
  await page.getByRole("textbox").first().fill("مرحبا بالعالم. هذا نص للاختبار.");
  await scan(page, "ar/midnight");
});

test("voice browser has no violations at every level", async ({ page }) => {
  await openFresh(page);
  const dlg = await openBrowser(page);
  await scan(page, "browser/country");
  await dlg.getByRole("button", { name: "All voices" }).click();
  await scan(page, "browser/home");
  await dlg.getByRole("button", { name: /^Arabic/ }).click();
  await scan(page, "browser/arabic");
  await dlg.getByRole("searchbox").fill("sa");
  await scan(page, "browser/search");
});

test("PDF import and OCR dialogs have no violations (English and Arabic)", async ({ page, browser }) => {
  const maker = await browser.newPage();
  await maker.setContent(`<div style="page-break-after:always">Text page.</div><canvas id="c" width="600" height="120"></canvas><script>document.getElementById('c').getContext('2d').fillText('Scan',10,60)</script>`);
  const pdf = await maker.pdf({ format: "A4" });
  await maker.close();
  await openFresh(page);
  for (const [locale, extract] of [["en", "Extract text"], ["ar", "استخراج النص"]]) {
    await page.context().addCookies([{ name: "locale", value: locale, url: "http://127.0.0.1" }]);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', { name: "mixed.pdf", mimeType: "application/pdf", buffer: pdf });
    await expect(page.getByRole("dialog").getByRole("button", { name: extract })).toBeVisible();
    await scan(page, `${locale}/pdf pages`);
    await page.getByRole("dialog").getByRole("button", { name: extract }).click();
    await expect(page.getByRole("dialog").getByRole("combobox")).toBeVisible();
    await scan(page, `${locale}/ocr offer`);
  }
});

test("About dialog has no violations (English and Arabic)", async ({ page }) => {
  await openFresh(page);
  for (const [locale, about] of [["en", "About"], ["ar", "حول الموقع"]]) {
    await page.context().addCookies([{ name: "locale", value: locale, url: "http://127.0.0.1" }]);
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("button", { name: about, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, `${locale}/about`);
  }
});

test("theme gallery has no violations", async ({ page }) => {
  await openFresh(page);
  await page.getByRole("button", { name: "Theme" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await scan(page, "theme gallery");
});

for (const theme of ["paper", "ocean", "lavender", "sunset", "sand", "graphite", "nordic", "wine", "mocha", "purple", "forest", "amoled", "slate", "arctic", "emerald", "rose"]) {
  test(`no contrast violations in theme: ${theme}`, async ({ page }) => {
    await openFresh(page);
    await page.context().addCookies([{ name: "theme", value: theme, url: "http://127.0.0.1" }]);
    await page.goto("/");
    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect(results.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" "))), theme).toEqual([]);
  });
}

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("full-screen voice browser has no violations", async ({ page }) => {
    await openFresh(page);
    await openBrowser(page);
    await page.waitForTimeout(300);
    await scan(page, "mobile/browser");
  });
});
