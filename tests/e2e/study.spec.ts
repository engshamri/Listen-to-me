import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { noHorizontalOverflow, stubSpeech } from "./helpers";

/*
 * The study workspace with tests/fixtures/lecture-enzymes.pdf: English pages
 * (prose, list, formula, table, code), an Arabic page, a scanned page and a
 * summary. Translation and speech are stubbed; OCR runs for real (on device).
 */

const LECTURE = join(__dirname, "..", "fixtures", "lecture-enzymes.pdf");

/** Stub translator: "AR:" before every paragraph; records request texts. */
async function stubTranslate(page: Page) {
  const requests: string[] = [];
  await page.route("**/api/translate", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { text: string };
    requests.push(body.text);
    const text = body.text
      .split("\n\n")
      .map((p) => `AR:${p}`)
      .join("\n\n");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text, detectedSource: "en", provider: "Google Translate" }) });
  });
  return requests;
}

async function openLecture(page: Page, { locale = "en" }: { locale?: string } = {}) {
  await page.goto("/study");
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  if (locale !== "en") await page.context().addCookies([{ name: "locale", value: locale, url: "http://127.0.0.1" }]);
  await page.goto("/study");
  await page.locator('input[type="file"][accept=".pdf,application/pdf"]').setInputFiles(LECTURE);
  await page.waitForURL(/\/study\/[\w-]+$/);
  await expect(page.locator('[data-page="1"] .textLayer span').first()).toBeAttached();
}

const panel = (page: Page) => page.locator("#study-tabpanel");
const pageInput = (page: Page) => page.locator("#study-page");

async function goToPage(page: Page, n: number) {
  await pageInput(page).fill(String(n));
  await pageInput(page).press("Enter");
  await expect(pageInput(page)).toHaveValue(String(n));
}

/** Selects the text of the first text-layer span on `pageNo` that contains `text`. */
async function selectInPdf(page: Page, pageNo: number, text: string) {
  await page.evaluate(
    ([n, t]) => {
      const span = [...document.querySelectorAll(`[data-page="${n}"] .textLayer span`)].find((s) => s.textContent?.includes(t as string));
      if (!span) throw new Error(`no span with ${t}`);
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    },
    [pageNo, text],
  );
  await expect(page.getByRole("toolbar", { name: "Selected text" })).toBeVisible();
}

test("opens a lecture PDF: pages, paragraphs linked to the PDF, title and progress", async ({ page }) => {
  await openLecture(page);
  await expect(page.locator("h1")).toHaveText("lecture enzymes");
  await expect(page.getByText("/ 5")).toBeVisible();
  const items = panel(page).locator("ol > li");
  await expect(items).toHaveCount(7);
  await expect(items.first()).toContainText("Lecture 3: Enzymes and Metabolism");
  await expect(items.nth(4)).toHaveText(/^Enzymes lower the activation energy of a reaction\./);

  // A paragraph is framed on the page.
  await items.nth(1).getByRole("button", { name: "Show on the page" }).click();
  await expect(page.locator('[data-page="1"] [data-testid="paragraph-focus"]')).toBeVisible();

  // Page 2: formula, table and code keep their structure.
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(pageInput(page)).toHaveValue("2");
  await expect(panel(page)).toContainText("Text of page 2");
  await expect(panel(page).locator("pre").filter({ hasText: "Enzyme | Substrate | Km (mM)" })).toBeVisible();
  await expect(panel(page).locator("pre").filter({ hasText: "def velocity" })).toHaveText("def velocity(vmax, km, s):\n    return vmax * s / (km + s)");

  // Reopening continues on the same page; the Study page offers to continue.
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(pageInput(page)).toHaveValue("2");
  await page.getByRole("link", { name: "All lectures" }).click();
  await expect(page.getByRole("region", { name: "Continue studying" })).toContainText("Page 2 of 5");
});

test("search finds every match in the lecture and jumps to it", async ({ page }) => {
  await openLecture(page);
  await page.locator("#study-search").fill("Michaelis");
  const results = page.locator('#study-search-results [role="option"]');
  await expect(results).toHaveCount(3);
  await expect(results.first()).toContainText("Page 2");
  await results.first().click();
  await expect(pageInput(page)).toHaveValue("2");
  await expect(page.locator('[data-page="2"] .textLayer span.search-hit').first()).toBeAttached();
  // Arabic text is found too.
  await page.locator("#study-search").fill("الانزيمات");
  await expect(results.first()).toContainText("Page 3");
});

test("highlights and notes from a selection, saved and exported with page numbers", async ({ page }) => {
  await openLecture(page);
  await selectInPdf(page, 1, "catalysts");
  await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "Highlight in Green" }).click();
  await expect(page.locator('[data-page="1"] .mix-blend-multiply')).toHaveCount(1);

  await selectInPdf(page, 1, "Above the optimum");
  await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "Note" }).click();
  await expect(panel(page).getByRole("heading", { name: "Notes and highlights" })).toBeVisible();
  const note = panel(page).getByRole("textbox").last();
  await expect(note).toBeFocused();
  await note.fill("Denaturation: exam question!");
  await note.blur();

  await page.reload();
  await expect(page.locator('[data-page="1"] .mix-blend-multiply')).toHaveCount(2);
  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(panel(page).getByRole("textbox").last()).toHaveValue("Denaturation: exam question!");
  const [download] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Export notes" }).click()]);
  const md = readFileSync((await download.path())!, "utf8");
  expect(md).toContain("# lecture enzymes");
  expect(md).toContain("## Page 1");
  expect(md).toContain("Denaturation: exam question!");

  // A page bookmark.
  await panel(page).getByRole("button", { name: "Bookmark this page" }).click();
  await expect(panel(page).getByRole("button", { name: "Remove the bookmark" })).toBeVisible();
});

test("translation: consent first, paragraph-aligned, glossary terms kept, code and formulas untouched", async ({ page }) => {
  const requests = await stubTranslate(page);
  await openLecture(page);
  await page.getByRole("tab", { name: "Translation" }).click();
  await panel(page).getByRole("button", { name: "Translate this page" }).click();

  // Nothing is sent before consent; declining sends nothing.
  const consent = page.getByRole("dialog", { name: "Send text to Google Translate?" });
  await expect(consent).toBeVisible();
  await consent.getByRole("button", { name: "Not now" }).click();
  expect(requests).toHaveLength(0);

  await panel(page).getByRole("button", { name: "Translate this page" }).click();
  await consent.getByRole("button", { name: "Allow" }).click();
  await expect(panel(page).locator("ol > li")).toHaveCount(7);
  await expect(panel(page).locator("ol > li").nth(1)).toContainText("AR:Enzymes are biological catalysts");
  expect(requests).toHaveLength(1);

  // Glossary: "active site" stays as the student prefers it.
  await page.getByRole("tab", { name: "Glossary" }).click();
  await panel(page).getByLabel("Term", { exact: true }).fill("active site");
  await panel(page).getByLabel("Preferred translation").fill("الموقع النشط");
  await panel(page).getByRole("button", { name: "Add term" }).click();
  await expect(panel(page).getByRole("listitem").filter({ hasText: "الموقع النشط (active site)" })).toBeVisible();
  await page.getByRole("tab", { name: "Translation" }).click();
  await panel(page).getByRole("button", { name: "Translate this page" }).click();
  await expect(panel(page).locator("ol > li").nth(1)).toContainText("الموقع النشط (active site)");
  expect(requests.at(-1)).toContain("[[1]]");
  expect(requests).toHaveLength(2); // consent remembered: no second dialog

  // Page 2: the formula and the code are not sent.
  await page.getByRole("button", { name: "Next page" }).click();
  await panel(page).getByRole("button", { name: "Translate this page" }).click();
  await expect(panel(page).getByText("Not translated (code or formula)")).toHaveCount(2);
  expect(requests.at(-1)).not.toContain("def velocity");
  expect(requests.at(-1)).not.toContain("Vmax × [S]");

  const [download] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Export translation" }).click()]);
  const md = readFileSync((await download.path())!, "utf8");
  expect(md).toContain("## Page 1\n\n> Lecture 3: Enzymes and Metabolism\n\nAR:Lecture 3: Enzymes and Metabolism");
  expect(md).toContain("## Page 2");

  // The Study page shows the consent and lets the student withdraw it.
  await page.getByRole("link", { name: "All lectures" }).click();
  const privacy = page.getByRole("listitem").filter({ hasText: "Translation · Google Translate" });
  await expect(privacy).toContainText("Allowed");
  await privacy.getByRole("button", { name: "Withdraw" }).click();
  await expect(privacy).toContainText("Not allowed yet");
});

test("translating the whole lecture: batched, skips the scanned page, with progress", async ({ page }) => {
  const requests = await stubTranslate(page);
  await openLecture(page);
  await page.evaluate(() => localStorage.setItem("asmani:study", JSON.stringify({ consentTranslate: true })));
  await page.reload();
  await page.getByRole("tab", { name: "Translation" }).click();
  await panel(page).getByRole("button", { name: "Translate the whole lecture" }).click();
  await expect(panel(page).locator("ol > li").first()).toContainText("AR:Lecture 3");
  expect(requests.length).toBeLessThanOrEqual(2);
  await goToPage(page, 3);
  await expect(panel(page).locator("ol > li").first()).toContainText("AR:الإنزيمات في الجسم");
  await goToPage(page, 4);
  await expect(panel(page)).toContainText("This page has no text layer");
});

test("scanned pages are recognized on the device (OCR) and labelled", async ({ page }) => {
  test.slow();
  await openLecture(page);
  await goToPage(page, 4);
  await expect(panel(page)).toContainText("This page has no text layer; it is probably a scanned image.");
  await panel(page).getByRole("button", { name: "Recognize the text (OCR)" }).click();
  await expect(panel(page).getByText(/Recognized by OCR · confidence \d+%/)).toBeVisible({ timeout: 120_000 });
  await expect(panel(page).locator("ol > li").first()).toContainText(/Competitive\s+inhibitors/);
  // Search now finds the recognized text.
  await page.locator("#study-search").fill("inhibitors bind");
  await expect(page.locator('#study-search-results [role="option"]').first()).toContainText("Page 4");
});

test("listening: consent, then the listening bar reads the page with the sentence shown", async ({ page }) => {
  await stubSpeech(page, []);
  await openLecture(page);
  await page.getByRole("button", { name: "Listen to this page" }).click();
  const consent = page.getByRole("dialog", { name: "Send text to Microsoft?" });
  await consent.getByRole("button", { name: "Allow" }).click();
  const bar = page.getByRole("region", { name: "Listen" });
  await expect(bar).toContainText("Text of page 1");
  await expect.poll(() => page.locator("main audio").evaluate((a: HTMLAudioElement) => !a.paused)).toBe(true);
  await expect(bar.getByRole("button", { name: "Repeat this sentence" })).toBeEnabled();
  await bar.getByRole("button", { name: "Bookmark this sentence" }).click();
  await bar.getByRole("button", { name: "Stop listening" }).click();
  await expect(bar).toHaveCount(0);
  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(panel(page).getByRole("listitem").first()).toContainText("Bookmark");
});

test("courses: create, move a lecture into it, rename, complete, delete", async ({ page }) => {
  await openLecture(page);
  await page.getByRole("link", { name: "All lectures" }).click();
  await page.getByRole("button", { name: "New course" }).click();
  await page.getByLabel("Course name").fill("Biochemistry");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: /Biochemistry/ })).toBeVisible();

  await page.getByRole("button", { name: "Lecture actions: lecture enzymes" }).click();
  await page.getByRole("menuitemradio", { name: "Biochemistry" }).click();
  const course = page.getByRole("region", { name: /^Biochemistry/ });
  await expect(course).toContainText("lecture enzymes");

  await page.getByRole("button", { name: "Lecture actions: lecture enzymes" }).click();
  await page.getByRole("menuitem", { name: "Mark as completed" }).click();
  await expect(course).toContainText("Completed");

  await page.getByRole("button", { name: "Lecture actions: lecture enzymes" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this lecture?" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(course).toContainText("No lectures yet.");
});

test("Arabic interface: right-to-left workspace with the Arabic page", async ({ page }) => {
  await openLecture(page, { locale: "ar" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await pageInput(page).fill("3");
  await pageInput(page).press("Enter");
  await expect(panel(page)).toContainText("نص الصفحة 3");
  await expect(panel(page).locator("ol > li").nth(1)).toContainText("الإنزيمات بروتينات تسرّع التفاعلات الكيميائية");
});

test("no accessibility violations (study page, workspace tabs, consent, selection toolbar, dark theme)", async ({ page }) => {
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.nodes.length}) ${v.nodes.map((n) => `${n.target} ${n.html.slice(0, 120)} ${n.failureSummary?.slice(0, 160)}`).join(" || ")}`), label).toEqual([]);
  };
  await stubTranslate(page);
  await page.goto("/study");
  await scan("study page, empty");
  await openLecture(page);
  await scan("workspace/text");
  await page.getByRole("tab", { name: "Translation" }).click();
  await panel(page).getByRole("button", { name: "Translate this page" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  await scan("consent");
  await page.getByRole("dialog").getByRole("button", { name: "Allow" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(panel(page).locator("ol > li").first()).toContainText("AR:");
  await scan("workspace/translation");
  await page.getByRole("tab", { name: "Notes" }).click();
  await scan("workspace/notes");
  await page.getByRole("tab", { name: "Glossary" }).click();
  await scan("workspace/glossary");
  await selectInPdf(page, 1, "catalysts");
  await scan("selection toolbar");
  await page.context().addCookies([{ name: "theme", value: "midnight", url: "http://127.0.0.1" }]);
  await page.goto("/study");
  await scan("study page with a lecture, dark");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("one view at a time, no sideways scrolling", async ({ page }) => {
    await openLecture(page);
    await noHorizontalOverflow(page);
    await expect(page.locator('[data-page="1"]')).toBeVisible();
    await page.getByRole("tab", { name: "Text" }).click();
    await expect(panel(page)).toContainText("Text of page 1");
    await expect(page.locator('[data-page="1"]')).toBeHidden();
    await noHorizontalOverflow(page);
    await page.getByRole("tab", { name: "PDF" }).click();
    await expect(page.locator('[data-page="1"]')).toBeVisible();
  });
});
