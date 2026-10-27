// PDF import in real older WebKit engines (Safari's engine) with an iPhone 13
// profile. Our Playwright's own WebKit is recent (27.x) and has APIs older
// iPhones lack; older Playwright releases bundle older engines:
//   1.45.3 → WebKit 17.4   1.48.2 → 18.0   1.49.1 → 18.2   1.56.1 → 26.0
// Each is installed once into .cache/old-webkit (outside package.json).
// These are emulated engines on this computer, not physical iPhones.
//
// Usage: start the app (npm run build && npm start), then
//   BASE_URL=http://127.0.0.1:3000 npm run test:old-webkit
//   OLD_WEBKIT=1.45.3,1.48.2,1.49.1,1.56.1 … (default: 1.56.1)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const VERSIONS = (process.env.OLD_WEBKIT || "1.56.1").split(",").map((v) => v.trim()).filter(Boolean);
const fixture = (name) => join(root, "tests", "fixtures", name);
const BOOK = fixture(join("generated", "arabic-book-450.pdf"));
const REPORT = fixture(join("generated", "security-report-15.pdf"));

function engine(version) {
  const dir = join(root, ".cache", "old-webkit", `pw-${version}`);
  const cli = join(dir, "node_modules", "playwright-core", "cli.js");
  if (!existsSync(cli)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true }));
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund", "--silent", `playwright-core@${version}`], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
  }
  execFileSync(process.execPath, [cli, "install", "webkit"], { cwd: dir, stdio: "inherit" });
  return createRequire(join(dir, "package.json"))("playwright-core");
}

let failures = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name} — ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

/** Imports pages through the Upload tool and returns the editor text. */
async function importPages(page, file, pages, { password } = {}) {
  await page.goto(BASE);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload", exact: true }).click()]);
  await chooser.setFiles(file);
  const dialog = page.getByRole("dialog");
  if (password) {
    await dialog.getByLabel("Password").fill(password);
    await dialog.getByRole("button", { name: "Open", exact: true }).click();
  }
  await dialog.getByRole("radio", { name: "Several pages or ranges" }).check({ timeout: 60_000 });
  await dialog.getByLabel("Pages and ranges").fill(pages);
  await dialog.getByRole("button", { name: "Extract text" }).click();
  await Promise.race([
    dialog.waitFor({ state: "hidden", timeout: 90_000 }),
    dialog.getByRole("alert").waitFor({ timeout: 90_000 }).then(async () => {
      throw new Error(`error shown: ${await dialog.getByRole("alert").innerText()}`);
    }),
  ]);
  return page.locator("#editor").inputValue();
}

const expectIn = (text, parts, absent = []) => {
  for (const p of parts) if (!text.includes(p)) throw new Error(`missing “${p}”`);
  for (const p of absent) if (text.includes(p)) throw new Error(`unexpected “${p}”`);
};

for (const version of VERSIONS) {
  const { webkit, devices } = engine(version);
  const browser = await webkit.launch();
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  const info = await page.evaluate(() => ({
    webkit: navigator.userAgent.match(/Version\/([\d.]+)/)?.[1],
    asyncIteration: typeof ReadableStream.prototype[Symbol.asyncIterator] === "function",
  }));
  console.log(`\nWebKit ${info.webkit} (Playwright ${version}; ReadableStream async iteration: ${info.asyncIteration ? "yes" : "no"}) against ${BASE}`);

  await check("PDF check page: every step passes", async () => {
    await page.goto(`${BASE}/pdf-check`);
    await page.getByText("All steps passed").waitFor({ timeout: 90_000 });
  });
  await check("English page 2 and Arabic page 3 of the lecture", async () => {
    const text = await importPages(page, fixture("lecture-enzymes.pdf"), "2-3");
    expectIn(text, ["Michaelis–Menten kinetics", "الإنزيمات بروتينات تسرّع التفاعلات"], ["Lecture 3: Enzymes and Metabolism"]);
    if (/[یکھ]/u.test(text)) throw new Error("Persian letter forms in Arabic text");
  });
  await check("owner-restricted PDF (opens without a password)", async () => {
    expectIn(await importPages(page, fixture("lecture-restricted.pdf"), "2"), ["Michaelis"]);
  });
  await check("password-protected PDF with its password", async () => {
    expectIn(await importPages(page, fixture("lecture-password.pdf"), "1", { password: "study123" }), ["Lecture 3: Enzymes and Metabolism"]);
  });
  await check("scanned page recognized on the device (OCR)", async () => {
    await page.goto(BASE);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload", exact: true }).click()]);
    await chooser.setFiles(fixture("lecture-enzymes.pdf"));
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Single page" }).check({ timeout: 60_000 });
    await dialog.getByLabel("Page", { exact: true }).fill("4");
    await dialog.getByRole("button", { name: "Extract text" }).click();
    await dialog.getByLabel("Document language").selectOption("eng");
    await dialog.getByRole("button", { name: "Recognize text" }).click();
    // Some engines here (Playwright's Windows WebKit 17.4) have no WebAssembly, like iPhones in
    // Lockdown Mode: then the app must say so instead of hanging.
    if (!(await page.evaluate(() => typeof WebAssembly === "object"))) {
      await dialog.getByRole("alert").getByText(/needs WebAssembly/).waitFor({ timeout: 30_000 });
      return "no WebAssembly in this engine: the app explains that OCR can't run";
    }
    // Some emulated engines here have WebAssembly without SIMD or JIT (real Safari has both);
    // the engine may then fail to start: the app must say so within its time limit, not hang.
    const outcome = await Promise.race([
      dialog.waitFor({ state: "hidden", timeout: 200_000 }).then(() => "done"),
      dialog.getByRole("alert").getByText(/engine didn't start/).waitFor({ timeout: 200_000 }).then(() => "engine failed"),
    ]);
    if (outcome === "engine failed") return "the OCR engine didn't start in this emulated engine; the app said so instead of hanging";
    expectIn(await page.locator("#editor").inputValue(), ["Competitive inhibitors"]);
  });
  if (existsSync(REPORT)) {
    await check("15-page technical report with images: all pages", async () => {
      const text = await importPages(page, REPORT, "1-15");
      expectIn(text, ["Finding 1:", "Finding 15:", "nmap -sS -sV -O -p-", "445/tcp"]);
    });
  }
  if (existsSync(BOOK)) {
    await check("450-page Arabic book, pages 440-445 exactly", async () => {
      const text = await importPages(page, BOOK, "440-445");
      expectIn(text, ["الصفحة 440:", "الصفحة 445:"], ["الصفحة 439:", "الصفحة 446:"]);
    });
  }
  await check("Study: a lecture is added and its text and PDF appear", async () => {
    await page.goto(`${BASE}/study`);
    await page.locator('input[type="file"][accept=".pdf,application/pdf"]').setInputFiles(fixture("lecture-enzymes.pdf"));
    await page.waitForURL(/\/study\/[\w-]+$/, { timeout: 90_000 });
    await page.locator('[data-page="1"] .textLayer span').first().waitFor({ state: "attached", timeout: 60_000 });
    await page.getByRole("tab", { name: "Text" }).click();
    expectIn(await page.locator("#study-tabpanel").innerText(), ["Enzymes are biological catalysts"]);
  });
  await check("a reader failure shows its code and a copyable diagnostic report", async () => {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const p = await ctx.newPage();
    await p.route(/\/pdfjs\/pdf\.worker-[\d.]+\.min\.mjs$/, (route) => route.fulfill({ status: 404, body: "missing" }));
    await p.goto(BASE);
    const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.getByRole("button", { name: "Upload", exact: true }).click()]);
    await chooser.setFiles(fixture("lecture-enzymes.pdf"));
    await p.getByRole("button", { name: "Copy diagnostic report" }).waitFor({ timeout: 60_000 });
    await p.getByText("Show the diagnostic report").click();
    const report = await p.getByLabel("Diagnostic report").inputValue();
    expectIn(report, ["Result: READER_FAILED", "pdf.js: 6.", "Features:"], ["lecture-enzymes"]);
    await ctx.close();
    return report.split("\n").find((l) => l.startsWith("Error:"));
  });
  await check("no uncaught page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll old-WebKit checks passed");
process.exit(failures ? 1 : 0);
