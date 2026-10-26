import { expect, test, type Browser } from "@playwright/test";
import { editor, openFresh } from "./helpers";

const fileInput = 'input[type="file"]';

/** Builds a real PDF with the browser's print engine. */
async function makePdf(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setContent(`<html><head><meta charset="utf-8"><style>body{font-family:'Segoe UI',Arial,sans-serif;font-size:20px} .p{page-break-after:always}</style></head><body>${html}</body></html>`);
  const pdf = await page.pdf({ format: "A4" });
  await page.close();
  return pdf;
}

test("imports a legacy Windows-1256 Arabic TXT, flags the guessed encoding, and allows changing it", async ({ page }) => {
  await openFresh(page);
  const bytes = Buffer.from([0xe3, 0xd1, 0xcd, 0xc8, 0xc7, 0x20, 0xc8, 0xc7, 0xe1, 0xda, 0xc7, 0xe1, 0xe3]); // "مرحبا بالعالم"
  await page.setInputFiles(fileInput, { name: "legacy.txt", mimeType: "text/plain", buffer: bytes });
  await expect(editor(page)).toHaveValue("مرحبا بالعالم");
  await expect(page.getByText(/Encoding was guessed as windows-1256/)).toBeVisible();
  await expect(page.getByLabel("Encoding")).toHaveValue("windows-1256");

  await page.getByRole("button", { name: "Remove imported file" }).click();
  await expect(editor(page)).toHaveValue("");
});

test("imports UTF-8 TXT with BOM; Clear can be undone", async ({ page }) => {
  await openFresh(page);
  await page.setInputFiles(fileInput, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("First line\n\nSecond paragraph — العربية", "utf8")]) });
  await expect(editor(page)).toHaveValue("First line\n\nSecond paragraph — العربية");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(editor(page)).toHaveValue("");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(editor(page)).toHaveValue("First line\n\nSecond paragraph — العربية");
});

test("PDF: page count, page range, Arabic and English extraction", async ({ page, browser }) => {
  const pdf = await makePdf(
    browser,
    `<div class="p">Page one only. This should not be imported.</div>
     <div class="p" dir="rtl">مرحبا بالعالم. هذه الصفحة الثانية.</div>
     <div>Page three in English.</div>`,
  );
  await openFresh(page);
  await page.setInputFiles(fileInput, { name: "doc.pdf", mimeType: "application/pdf", buffer: pdf });
  const dialog = page.getByRole("dialog", { name: "Import PDF" });
  await expect(dialog.getByText("3 pages").first()).toBeVisible();
  await dialog.getByRole("radio", { name: "Page range" }).check();
  await dialog.getByLabel("From page").fill("2");
  await dialog.getByLabel("To page").fill("3");
  await expect(dialog.getByText("2 pages selected: 2-3")).toBeVisible();
  await dialog.getByRole("button", { name: "Extract text" }).click();
  await expect(dialog).toBeHidden();
  const text = await editor(page).inputValue();
  expect(text).toContain("مرحبا بالعالم");
  expect(text).toContain("Page three in English.");
  expect(text).not.toContain("Page one only");
  await expect(page.getByText("pages 2-3 of 3")).toBeVisible();
});

/** A page whose words exist only as pixels (like a scan): text drawn on a canvas. */
const scannedPage = (id: string, text: string, rtl = false) =>
  `<canvas id="${id}" width="900" height="160"></canvas><script>(()=>{const x=document.getElementById('${id}').getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,900,160);x.fillStyle='#000';x.font='48px Arial';x.direction='${rtl ? "rtl" : "ltr"}';x.fillText(${JSON.stringify(text)},${rtl ? 860 : 20},100)})()</script>`;

test("scanned PDF: OCR is offered, can be stopped, and recognizes English text on the device", async ({ page, browser }) => {
  const pdf = await makePdf(browser, scannedPage("c", "Scanned words are readable"));
  await openFresh(page);
  // Every network request, including those made by the OCR web worker, must stay on this server.
  const external: string[] = [];
  page.context().on("request", (r) => {
    const url = new URL(r.url());
    if (/^(https?|wss?):$/.test(url.protocol) && url.host !== new URL(page.url()).host) external.push(r.url());
  });
  await page.setInputFiles(fileInput, { name: "scan.pdf", mimeType: "application/pdf", buffer: pdf });
  const dialog = page.getByRole("dialog", { name: "Import PDF" });
  await dialog.getByRole("button", { name: "Extract text" }).click();
  await expect(dialog.getByText(/No selectable text was found/)).toBeVisible();

  // Stopping returns to the choice without importing anything.
  await dialog.getByRole("button", { name: "Recognize text" }).click();
  await dialog.getByRole("button", { name: "Stop" }).click();
  await expect(dialog.getByRole("button", { name: "Recognize text" })).toBeVisible();
  // The modal hides the page from the accessibility tree, so find the editor by id.
  await expect(page.locator("#editor")).toHaveValue("");

  await dialog.getByLabel("Document language").selectOption("eng");
  await dialog.getByRole("button", { name: "Recognize text" }).click();
  await expect(dialog).toBeHidden({ timeout: 90_000 });
  await expect(editor(page)).toHaveValue(/Scanned words are readable/);
  await expect(page.getByText("text recognized (OCR)")).toBeVisible();
  expect(external, "OCR must not contact third-party servers").toEqual([]);
});

test("scanned PDF: Arabic text is recognized", async ({ page, browser }) => {
  const pdf = await makePdf(browser, scannedPage("c", "مرحبا بالعالم", true));
  await openFresh(page);
  await page.setInputFiles(fileInput, { name: "scan-ar.pdf", mimeType: "application/pdf", buffer: pdf });
  const dialog = page.getByRole("dialog", { name: "Import PDF" });
  await dialog.getByRole("button", { name: "Extract text" }).click();
  await dialog.getByLabel("Document language").selectOption("ara");
  await dialog.getByRole("button", { name: "Recognize text" }).click();
  await expect(dialog).toBeHidden({ timeout: 90_000 });
  const text = await editor(page).inputValue();
  expect(text).toContain("مرحبا");
  expect(text).toContain("بالعالم");
});

test("mixed PDF: image-only pages are never dropped silently", async ({ page, browser }) => {
  const pdf = await makePdf(browser, `<div class="p">First page has real text.</div>${scannedPage("c", "Second page is a scan")}`);
  await openFresh(page);
  await page.setInputFiles(fileInput, { name: "mixed.pdf", mimeType: "application/pdf", buffer: pdf });
  const dialog = page.getByRole("dialog", { name: "Import PDF" });
  await dialog.getByRole("button", { name: "Extract text" }).click();
  await expect(dialog.getByText(/Page 2 has no selectable text/)).toBeVisible();

  // Explicitly skipping imports the text page and says what was skipped.
  await dialog.getByRole("button", { name: "Import without it" }).click();
  await expect(editor(page)).toHaveValue("First page has real text.");
  await expect(page.getByText(/1 page had no text/)).toBeVisible();

  // Recognizing merges both pages in order.
  await page.setInputFiles(fileInput, { name: "mixed.pdf", mimeType: "application/pdf", buffer: pdf });
  await dialog.getByRole("button", { name: "Extract text" }).click();
  await dialog.getByLabel("Document language").selectOption("eng");
  await dialog.getByRole("button", { name: "Recognize text" }).click();
  await expect(dialog).toBeHidden({ timeout: 90_000 });
  await expect(editor(page)).toHaveValue(/^First page has real text\.\n\nSecond page is a scan/);
});

test("malformed and unsupported files are rejected safely", async ({ page }) => {
  await openFresh(page);
  await page.setInputFiles(fileInput, { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf at all") });
  // Checked from the bytes right after choosing: no dialog opens for a file that isn't a PDF.
  await expect(page.getByText("This file isn't a PDF, even though it is named like one.")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.setInputFiles(fileInput, { name: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK\u0003\u0004") });
  await expect(page.getByText("This file type isn't supported. Choose a PDF or a TXT (plain text) file.")).toBeVisible();

  await page.setInputFiles(fileInput, { name: "binary.txt", mimeType: "text/plain", buffer: Buffer.from(Array.from({ length: 3000 }, (_, i) => (i % 5 === 0 ? 1 : 66))) });
  await expect(page.getByText("This file doesn't look like plain text.")).toBeVisible();
  await expect(editor(page)).toHaveValue("");
});

test("draft is restored after a refresh", async ({ page }) => {
  await openFresh(page);
  await editor(page).fill("Unsaved draft text — نص لم يُحفظ");
  await page.waitForTimeout(900);
  await page.reload();
  await expect(editor(page)).toHaveValue("Unsaved draft text — نص لم يُحفظ");
  await expect(page.getByText("Your unsaved text was restored.")).toBeVisible();
});
