import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { noHorizontalOverflow } from "./helpers";

/*
 * Practice tools without AI, on tests/fixtures/lecture-enzymes.pdf: "Ask your
 * lecture" (passage search), definitions, quizzes, flashcards with spaced
 * repetition, the review page, and backup/restore of the study data.
 * The fixture states three definitions: Enzymes (page 1), Km and low Km (page 2).
 */

const LECTURE = join(__dirname, "..", "fixtures", "lecture-enzymes.pdf");

const DEFINITIONS: Record<string, { definition: string; sentence: string }> = {
  Enzymes: {
    definition: "biological catalysts that speed up chemical reactions in living cells without being consumed",
    sentence: "Enzymes are biological catalysts that speed up chemical reactions in living cells without being consumed.",
  },
  Km: { definition: "the substrate concentration at which the velocity is half of Vmax", sentence: "Here Km is the substrate concentration at which the velocity is half of Vmax." },
  "low Km": { definition: "high affinity between enzyme and substrate", sentence: "A low Km means high affinity between enzyme and substrate." },
};

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

/** Deletes the study database (the open connection steps aside) and reloads. */
async function clearStudyData(page: Page) {
  await page.goto("/study");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase("asmani-study");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  );
  await page.reload();
  await expect(page.getByText("No lectures yet.").first()).toBeVisible();
}

/** Answers a question correctly, from what the lecture says. */
async function answerCorrectly(item: Locator) {
  if (await item.getByRole("radio", { name: "True" }).count()) {
    const statement = (await item.locator("p.bg-muted").innerText()).trim();
    const [term, ...rest] = statement.split(": ");
    const correct = DEFINITIONS[term]?.definition === rest.join(": ");
    await item.getByRole("radio", { name: correct ? "True" : "False" }).check();
  } else if (await item.getByRole("textbox", { name: "Your answer" }).count()) {
    const prompt = (await item.locator("p.bg-muted").innerText()).trim();
    const term = Object.keys(DEFINITIONS).find((k) => prompt === DEFINITIONS[k].sentence.replace(k, "_____") || prompt === `_____ : ${DEFINITIONS[k].definition}`);
    await item.getByRole("textbox", { name: "Your answer" }).fill(term ?? "?");
  } else {
    throw new Error(`unexpected question: ${await item.innerText()}`);
  }
}

test("Ask your lecture: passages with their pages, framed on the PDF; a plain “not found”; earlier questions", async ({ page }) => {
  await openLecture(page);
  await page.getByRole("tab", { name: "Ask" }).click();
  await expect(panel(page).getByText("Search, not AI")).toBeVisible();

  await panel(page).getByLabel("Your question").fill("What is the substrate concentration at half of Vmax?");
  await panel(page).getByRole("button", { name: "Search" }).click();
  await expect(panel(page).getByRole("status").filter({ hasText: /matching passages?/ })).toBeVisible();
  const first = panel(page).locator("ol > li").first();
  await expect(first).toContainText("Page 2");
  await expect(first).toContainText("Here Km is the substrate concentration");
  await expect(first.locator("mark").first()).toBeVisible();
  await first.getByRole("button", { name: "Show on the page" }).click();
  await expect(page.locator('[data-page="2"] [data-testid="paragraph-focus"]')).toBeVisible();

  await panel(page).getByLabel("Your question").fill("photosynthesis in chloroplasts");
  await panel(page).getByRole("button", { name: "Search" }).click();
  await expect(panel(page).getByText("Not found in the provided material.")).toBeVisible();
  await expect(panel(page).locator("ol > li")).toHaveCount(0);

  // Earlier questions run again with one click.
  await panel(page).getByRole("button", { name: "What is the substrate concentration at half of Vmax?" }).click();
  await expect(panel(page).locator("ol > li").first()).toContainText("Here Km is");
});

test("Ask in Arabic about an English lecture: the question is translated only after consent", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/translate", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { text: string; target: string };
    requests.push(`${body.target}:${body.text}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Michaelis Menten equation", detectedSource: "ar", provider: "Google Translate" }) });
  });
  await openLecture(page);
  await page.getByRole("tab", { name: "Ask" }).click();
  await panel(page).getByLabel("Your question").fill("ما هي معادلة ميكايليس منتن؟");
  await panel(page).getByRole("button", { name: "Search" }).click();
  await expect(panel(page).getByText("Your question and the lecture are in different languages")).toBeVisible();
  expect(requests).toEqual([]);

  await panel(page).getByRole("button", { name: "Translate my question into English and search" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Allow" }).click();
  await expect(panel(page).getByText("Searched for: Michaelis Menten equation")).toBeVisible();
  await expect(panel(page).locator("ol > li").first()).toContainText("Page 2");
  expect(requests).toEqual(["en:ما هي معادلة ميكايليس منتن؟"]);
});

test("Practice: definitions with pages become flashcards, reviewed with spaced repetition; import and export", async ({ page }) => {
  await openLecture(page);
  await page.getByRole("tab", { name: "Practice" }).click();
  await expect(panel(page).getByText("not by AI")).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "3 definitions found" })).toBeVisible();
  const items = panel(page).locator("ol > li");
  await expect(items).toHaveCount(3);
  await expect(items.first()).toContainText("Enzymes — biological catalysts");
  await items.nth(1).getByRole("button", { name: "Page 2" }).click();
  await expect(page.locator('[data-page="2"] [data-testid="paragraph-focus"]')).toBeVisible();

  await panel(page).getByRole("button", { name: "Make flashcards from all" }).click();
  await expect(page.getByText("3 flashcards added")).toBeVisible();
  await panel(page).getByRole("button", { name: "Make flashcards from all" }).click();
  await expect(page.getByText("These flashcards already exist.")).toBeVisible();

  await panel(page).getByRole("button", { name: "Flashcards", exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: "3 cards · 3 due now" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Review 3 due cards" }).click();
  await expect(panel(page).getByText("Card 1 of 3")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(panel(page).getByRole("button", { name: /Medium/ })).toBeVisible();
  await page.keyboard.press("3");
  await expect(panel(page).getByText("Card 2 of 3")).toBeVisible();
  await panel(page).getByRole("button", { name: "Show answer" }).click();
  await panel(page).getByRole("button", { name: /Again/ }).click();
  // "Again" brings the card back at the end of the session.
  await expect(panel(page).getByText("Card 3 of 4")).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await panel(page).getByRole("button", { name: "Show answer" }).click();
    await panel(page).getByRole("button", { name: /Easy/ }).click();
  }
  await expect(panel(page).getByText("Review finished: 4 cards.")).toBeVisible();
  await panel(page).getByRole("button", { name: "End review" }).click();
  await expect(panel(page).getByRole("heading", { name: "3 cards · 0 due now" })).toBeVisible();
  await expect(panel(page).getByText(/No cards are due\. The next one is due tomorrow\./)).toBeVisible();

  const [csv] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Export CSV (Anki)" }).click()]);
  const text = readFileSync((await csv.path())!, "utf8");
  expect(text.split("\n").slice(0, 3)).toEqual(["#separator:comma", "#html:false", "#columns:Front,Back"]);
  expect(text.split("\n")).toContain("Km,the substrate concentration at which the velocity is half of Vmax");

  await panel(page)
    .locator('input[type="file"]')
    .setInputFiles({ name: "cards.csv", mimeType: "text/csv", buffer: Buffer.from('front,back\nATP,"energy currency, of the cell"\n') });
  await expect(page.getByText("1 flashcard added")).toBeVisible();
  await panel(page).getByLabel("Front (question)").fill("Vmax");
  await panel(page).getByLabel("Back (answer)").fill("the maximum reaction velocity");
  await panel(page).getByRole("button", { name: "Add card" }).click();
  await expect(panel(page).getByRole("heading", { name: "5 cards · 2 due now" })).toBeVisible();

  // The Study page sums up due cards; the review page reviews all lectures.
  await page.getByRole("link", { name: "All lectures" }).click();
  const review = page.getByRole("region", { name: "Flashcard review" });
  await expect(review).toContainText("2 cards due");
  await review.getByRole("link", { name: "Review cards" }).click();
  await expect(page).toHaveURL(/\/study\/review$/);
  await page.getByRole("button", { name: "Review all due cards" }).click();
  await expect(page.getByText("Card 1 of 2")).toBeVisible();
  await expect(page.locator("main")).toContainText("lecture enzymes");
});

test("Quiz: practice mode checks each answer with its source; results are saved; missed questions can be retaken; export", async ({ page }) => {
  await openLecture(page);
  await page.getByRole("tab", { name: "Practice" }).click();
  await panel(page).getByRole("button", { name: "Quiz", exact: true }).click();
  await panel(page).getByLabel("Questions").selectOption("5");
  await panel(page).getByRole("radio", { name: /^Medium/ }).check();
  await panel(page).getByRole("radio", { name: /^Practice/ }).check();
  await panel(page).getByRole("button", { name: "Start quiz" }).click();
  await expect(panel(page).getByText("Only 3 questions could be made from the definitions on these pages.")).toBeVisible();
  const questions = panel(page).locator("ol > li");
  await expect(questions).toHaveCount(3);

  // Unanswered: every question shows the right answer and the lecture's sentence with its page.
  await panel(page).getByRole("button", { name: "Finish and see results" }).click();
  await expect(panel(page).getByRole("heading", { name: "0 of 3 correct (0%)" })).toBeVisible();
  await expect(questions.first()).toContainText("Not answered");
  await expect(questions.first()).toContainText("Correct answer:");
  await expect(questions.first()).toContainText(/From page [12]:/);

  const [md] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Export quiz and answer key" }).click()]);
  const text = readFileSync((await md.path())!, "utf8");
  expect(text).toContain("# lecture enzymes");
  expect(text).toContain("## Answer key");
  expect(text).toMatch(/1\. .+ \(Page [12]\)/);

  await panel(page).getByRole("button", { name: "Retake the questions I missed" }).click();
  await expect(questions).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const item = questions.nth(i);
    await answerCorrectly(item);
    await item.getByRole("button", { name: "Check" }).click();
    await expect(item.getByRole("status")).toHaveText("Correct");
  }
  await panel(page).getByRole("button", { name: "Finish and see results" }).click();
  await expect(panel(page).getByRole("heading", { name: "3 of 3 correct (100%)" })).toBeVisible();

  await panel(page).getByRole("button", { name: "New quiz" }).click();
  const history = panel(page).locator("ul").filter({ hasText: "correct" });
  await expect(history.locator("li")).toHaveCount(2);
  await expect(history.locator("li").first()).toContainText("3 of 3 correct (100%) · Medium · Practice");

  // Exam mode: timed, no per-question checking.
  await panel(page).getByRole("radio", { name: /^Exam/ }).check();
  await panel(page).getByRole("button", { name: "Start quiz" }).click();
  await expect(panel(page).getByText(/Time left: [23]:\d\d/)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Check" })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Finish and see results" }).click();
  await expect(panel(page).getByRole("heading", { name: /of 3 correct/ })).toBeVisible();

  await page.getByRole("link", { name: "All lectures" }).click();
  await expect(page.getByText("Last quiz: 0%")).toBeVisible();
});

test("Search a whole course and open another lecture at the page found", async ({ page }) => {
  await page.goto("/study");
  await page.evaluate(() => localStorage.clear());
  await page.getByRole("button", { name: "New course" }).click();
  await page.getByLabel("Course name").fill("Biochemistry");
  await page.getByRole("button", { name: "Create" }).click();
  const course = page.getByRole("region", { name: /^Biochemistry/ });
  const urls: string[] = [];
  for (let i = 0; i < 2; i++) {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), course.getByRole("button", { name: "Open a lecture PDF" }).click()]);
    await chooser.setFiles(LECTURE);
    await page.waitForURL(/\/study\/[\w-]+$/);
    urls.push(page.url());
    await page.getByRole("link", { name: "All lectures" }).click();
  }
  await page.goto(urls[0]);
  await page.getByRole("tab", { name: "Ask" }).click();
  await panel(page).getByRole("radio", { name: "All lectures in this course" }).check();
  await panel(page).getByLabel("Your question").fill("Michaelis Menten equation velocity");
  await panel(page).getByRole("button", { name: "Search" }).click();
  const other = panel(page).locator("ol > li").filter({ hasText: "lecture enzymes · page 2" }).first();
  await expect(other).toBeVisible();
  await other.getByRole("link", { name: "Open at this page" }).click();
  await expect(page).toHaveURL(`${urls[1]}?page=2`);
  await expect(pageInput(page)).toHaveValue("2");
});

test("Backup and restore: with PDFs everything comes back; without PDFs the lecture asks for its file; other files are refused", async ({ page }) => {
  await openLecture(page);
  await page.getByRole("tab", { name: "Practice" }).click();
  await panel(page).getByRole("button", { name: "Make flashcards from all" }).click();
  await expect(page.getByText("3 flashcards added")).toBeVisible();
  await page.getByRole("link", { name: "All lectures" }).click();

  const backup = page.getByRole("region", { name: "Backup and restore" });
  await expect(backup.getByLabel("Include the PDF files (larger file)")).toBeChecked();
  const [full] = await Promise.all([page.waitForEvent("download"), backup.getByRole("button", { name: "Download backup" }).click()]);
  expect(full.suggestedFilename()).toMatch(/^listen-to-me-study-backup-\d{4}-\d\d-\d\d\.json$/);
  const fullPath = (await full.path())!;
  const json = JSON.parse(readFileSync(fullPath, "utf8"));
  expect(json.format).toBe("listen-to-me/study-backup");
  expect(json.data.docs).toHaveLength(1);
  expect(json.data.cards).toHaveLength(3);
  expect(Object.keys(json.files)).toHaveLength(1);

  await backup.getByLabel("Include the PDF files (larger file)").uncheck();
  const [light] = await Promise.all([page.waitForEvent("download"), backup.getByRole("button", { name: "Download backup" }).click()]);
  const lightPath = (await light.path())!;
  expect(Object.keys(JSON.parse(readFileSync(lightPath, "utf8")).files)).toHaveLength(0);

  // Restore everything into an empty browser.
  await clearStudyData(page);
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(fullPath);
  await expect(page.getByText("Backup restored. Lectures: 1 · notes: 0 · flashcards: 3 · quiz results: 0.")).toBeVisible();
  await page.getByRole("link", { name: "lecture enzymes" }).click();
  await expect(page.locator('[data-page="1"] .textLayer span').first()).toBeAttached();

  // Without PDFs: the lecture opens with its text and asks for the PDF.
  await clearStudyData(page);
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(lightPath);
  await expect(page.getByText("1 lecture was restored without its PDF.")).toBeVisible();
  await page.getByRole("link", { name: "lecture enzymes" }).click();
  await expect(page.getByText("This lecture's PDF isn't on this device")).toBeVisible();
  await expect(panel(page).locator("ol > li").first()).toContainText("Lecture 3: Enzymes and Metabolism");
  await page.locator('input[type="file"][accept=".pdf,application/pdf"]').setInputFiles(LECTURE);
  await expect(page.locator('[data-page="1"] .textLayer span').first()).toBeAttached();

  await page.getByRole("link", { name: "All lectures" }).click();
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByText("This file isn't a Study backup.")).toBeVisible();
});

test("Arabic interface: practice tools right to left", async ({ page }) => {
  await openLecture(page, { locale: "ar" });
  await page.getByRole("tab", { name: "تدرّب" }).click();
  await expect(panel(page).getByRole("heading", { name: "عُثر على 3 تعريفات" })).toBeVisible();
  await page.getByRole("tab", { name: "اسأل" }).click();
  await panel(page).getByLabel("سؤالك").fill("كواكب المجرة");
  await panel(page).getByRole("button", { name: "ابحث" }).click();
  await expect(panel(page).getByText("غير موجود في المادة المقدَّمة.")).toBeVisible();
});

test("no accessibility violations in the practice tools", async ({ page }) => {
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.nodes.length}) ${v.nodes.map((n) => `${n.target} ${n.html.slice(0, 120)} ${n.failureSummary?.slice(0, 160)}`).join(" || ")}`), label).toEqual([]);
  };
  await openLecture(page);
  await page.getByRole("tab", { name: "Ask" }).click();
  await panel(page).getByLabel("Your question").fill("substrate concentration");
  await panel(page).getByRole("button", { name: "Search" }).click();
  await expect(panel(page).locator("ol > li").first()).toBeVisible();
  await scan("ask with results");
  await page.getByRole("tab", { name: "Practice" }).click();
  await scan("definitions");
  await panel(page).getByRole("button", { name: "Make flashcards from all" }).click();
  await panel(page).getByRole("button", { name: "Quiz", exact: true }).click();
  await scan("quiz setup");
  await panel(page).getByRole("button", { name: "Start quiz" }).click();
  await scan("quiz running");
  await panel(page).getByRole("button", { name: "Finish and see results" }).click();
  await scan("quiz results");
  await panel(page).getByRole("button", { name: "Flashcards", exact: true }).click();
  await panel(page).getByRole("button", { name: /^Review \d+ due cards?$/ }).click();
  await panel(page).getByRole("button", { name: "Show answer" }).click();
  await scan("flashcard review");
  await page.getByRole("link", { name: "All lectures" }).click();
  await scan("study page with review and backup");
  await page.context().addCookies([{ name: "theme", value: "midnight", url: "http://127.0.0.1" }]);
  await page.goto("/study/review");
  await scan("review page, dark");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("practice tools fit a phone screen", async ({ page }) => {
    await openLecture(page);
    await page.getByRole("tab", { name: "Practice" }).click();
    await expect(panel(page).getByRole("heading", { name: "3 definitions found" })).toBeVisible();
    await noHorizontalOverflow(page);
    await panel(page).getByRole("button", { name: "Quiz", exact: true }).click();
    await panel(page).getByRole("button", { name: "Start quiz" }).click();
    await expect(panel(page).locator("ol > li").first()).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole("tab", { name: "Ask" }).click();
    await noHorizontalOverflow(page);
  });
});
