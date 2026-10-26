import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { editor, noHorizontalOverflow, openFresh } from "./helpers";

/* The five text tools above the editor, in desktop Edge and in WebKit with an iPhone 13 profile. */

const TOOLS_EN = ["Upload", "Paste", "Sample", "Clean up", "Clear"];
const TOOLS_AR = ["رفع ملف", "لصق", "عينة", "تنظيف", "حذف"];
const tools = (page: Page, label: string) => page.getByRole("group", { name: label });

/** Every tool shows its name, the name is its accessible name, and it is at least 44 × 44 px. */
async function checkTools(page: Page, groupLabel: string, names: string[]) {
  const group = tools(page, groupLabel);
  await expect(group.getByRole("button")).toHaveCount(5);
  for (const [i, name] of names.entries()) {
    const button = group.getByRole("button").nth(i);
    await expect(button).toHaveAccessibleName(name);
    await expect(button.getByText(name, { exact: true })).toBeVisible();
    await expect(button).not.toHaveAttribute("aria-label");
    const box = (await button.boundingBox())!;
    expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
    // The name isn't cut off.
    expect(await button.evaluate((b) => b.scrollWidth <= b.clientWidth + 1)).toBe(true);
  }
  await noHorizontalOverflow(page);
}

test("the five tools show their names in English, each at least 44 px and named for screen readers", async ({ page }) => {
  await openFresh(page);
  await checkTools(page, "Text tools", TOOLS_EN);
});

test("Arabic: the same five tools with Arabic names, right to left", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
  await page.goto("/");
  await checkTools(page, "أدوات النص", TOOLS_AR);
  // The first tool sits at the inline start: the right edge in RTL.
  const boxes = await Promise.all(TOOLS_AR.map((n) => tools(page, "أدوات النص").getByRole("button", { name: n }).boundingBox()));
  expect(boxes[0]!.x).toBeGreaterThan(boxes[4]!.x);
});

test("each tool still does its job: sample, clean up, clear with undo, upload opens the file chooser", async ({ page }) => {
  await openFresh(page);
  const group = tools(page, "Text tools");
  await expect(group.getByRole("button", { name: "Clear" })).toBeDisabled();
  await expect(group.getByRole("button", { name: "Clean up" })).toBeDisabled();

  await group.getByRole("button", { name: "Sample" }).click();
  await expect(editor(page)).toHaveValue(/^Welcome to Listen to me/);
  await expect(page.getByText("Sample text inserted")).toBeVisible();

  await editor(page).fill("Too   many    spaces\n\n\n\nhere");
  await group.getByRole("button", { name: "Clean up" }).click();
  await page.getByRole("menuitem", { name: /spaces/i }).click();
  await expect(editor(page)).toHaveValue("Too many spaces\n\nhere");

  await group.getByRole("button", { name: "Clear" }).click();
  await expect(editor(page)).toHaveValue("");
  // Undo in the "Text cleared" notification (the clean-up one may still be showing).
  await page.locator("[data-sonner-toast]").filter({ hasText: "Text cleared" }).getByRole("button", { name: "Undo" }).click();
  await expect(editor(page)).toHaveValue("Too many spaces\n\nhere");

  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), group.getByRole("button", { name: "Upload" }).click()]);
  await chooser.setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("From the picker.") });
  await expect(editor(page)).toHaveValue("From the picker.");
});

test("paste reads the clipboard, and explains what to do when the browser refuses", async ({ page, browserName, context }) => {
  test.skip(browserName !== "chromium", "Clipboard permissions can be granted only in Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openFresh(page);
  await page.evaluate(() => navigator.clipboard.writeText("Copied lecture notes"));
  await tools(page, "Text tools").getByRole("button", { name: "Paste" }).click();
  await expect(editor(page)).toHaveValue("Copied lecture notes");
  await expect(page.getByText("Pasted from clipboard")).toBeVisible();

  await context.clearPermissions();
  await page.evaluate(() => {
    navigator.clipboard.readText = () => Promise.reject(new DOMException("Denied", "NotAllowedError"));
  });
  await tools(page, "Text tools").getByRole("button", { name: "Paste" }).click();
  await expect(page.getByText(/Tap and hold in the text box and choose Paste, or press Ctrl\+V/)).toBeVisible();
  await expect(editor(page)).toHaveValue("Copied lecture notes");
});

test("tooltips explain each tool on hover and keyboard focus; the tools are reachable by keyboard", async ({ page, isMobile }) => {
  test.skip(isMobile, "Hover and keyboard tooltips are for desktop");
  await openFresh(page);
  const group = tools(page, "Text tools");
  await group.getByRole("button", { name: "Upload" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Import a PDF or TXT file from this device");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await group.getByRole("button", { name: "Sample" }).focus();
  await expect(page.getByRole("tooltip")).toHaveText("Insert an example text to try a voice");
  // A visible focus ring.
  const outline = await group.getByRole("button", { name: "Sample" }).evaluate((b) => {
    const s = getComputedStyle(b);
    return s.outlineStyle !== "none" || s.boxShadow !== "none";
  });
  expect(outline).toBe(true);
  await page.keyboard.press("Enter");
  await expect(editor(page)).toHaveValue(/^Welcome to Listen to me/);
});

test("no accessibility violations in the text tools (light and dark themes)", async ({ page }) => {
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).include('[role="group"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
  };
  await openFresh(page);
  await editor(page).fill("Some text so every tool is enabled.");
  await scan("light");
  for (const theme of ["midnight", "ocean"]) {
    await page.context().addCookies([{ name: "theme", value: theme, url: "http://127.0.0.1" }]);
    await page.reload();
    await editor(page).fill("Some text so every tool is enabled.");
    await scan(theme);
  }
});

test.describe("small phone (320 px)", () => {
  test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });

  test("the tools fit without sideways scrolling or cut-off names", async ({ page }) => {
    await openFresh(page);
    await checkTools(page, "Text tools", TOOLS_EN);
  });
});
