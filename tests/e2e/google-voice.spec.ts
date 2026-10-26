import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_AUDIO, editor, generateButton, openBrowser, openFresh } from "./helpers";

/* Google's Arabic voice: the second free source (no key, no account). */

const TEXT = "مرحباً بكم في اسمعني. هذا اختبار لصوت جوجل.";

/** Answers /api/tts like the server does for Google: audio, estimated word times, and "timing: estimated". */
async function stubGoogle(page: Page, requests: string[]) {
  const words = TEXT.split(/\s+/).map((text, i) => ({ text, start: i * 0.7, end: i * 0.7 + 0.6 }));
  const b = "googleboundary";
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="audio"; filename="speech.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`),
    FIXTURE_AUDIO,
    Buffer.from(`\r\n--${b}\r\nContent-Disposition: form-data; name="words"\r\n\r\n${JSON.stringify(words)}\r\n--${b}\r\nContent-Disposition: form-data; name="timing"\r\n\r\nestimated\r\n--${b}--\r\n`),
  ]);
  await page.route("**/api/tts", async (route) => {
    requests.push((JSON.parse(route.request().postData() ?? "{}") as { voice: string }).voice);
    await route.fulfill({ status: 200, headers: { "Content-Type": `multipart/form-data; boundary=${b}` }, body });
  });
}

async function chooseGoogle(page: Page) {
  const dlg = await openBrowser(page);
  await dlg.getByRole("button", { name: /^Arabic/ }).click();
  const section = dlg.getByRole("region", { name: "More Arabic voices" });
  await expect(section).toContainText("From Google's free speech service, in Standard Arabic.");
  await section.getByRole("button", { name: /^Use Google\./ }).click();
  await expect(dlg).toBeHidden();
}

test("the Google Arabic voice is listed under More Arabic voices and can be chosen", async ({ page }) => {
  await openFresh(page);
  await chooseGoogle(page);
  const current = page.getByRole("group", { name: "Current voice" });
  await expect(current).toContainText("Google");
  await expect(current).toContainText("Arabic · Standard Arabic");
  // Speed and pitch don't apply to this voice: disabled, with the reason.
  await expect(page.getByRole("slider", { name: "Speed" })).toHaveAttribute("data-disabled", "");
  await expect(page.getByRole("slider", { name: "Pitch" })).toHaveAttribute("data-disabled", "");
  await expect(page.getByRole("note")).toHaveText("This voice reads at a fixed speed and pitch. To listen faster or slower, use Listening speed under the result.");
  // The privacy note (shown once there is text) names the service that receives the text.
  await editor(page).fill(TEXT);
  await expect(page.getByText("Your text is sent to Google's speech service to create the audio.")).toBeVisible();
  // Search finds it too.
  const dlg = await openBrowser(page);
  await dlg.getByRole("searchbox").fill("google");
  await expect(dlg.getByRole("button", { name: /^Use Google\./ })).toHaveCount(1);
});

test("generating with the Google voice: read-along says the timing is approximate", async ({ page }) => {
  const requests: string[] = [];
  await stubGoogle(page, requests);
  await openFresh(page);
  await chooseGoogle(page);
  await editor(page).fill(TEXT);
  await generateButton(page).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  expect(requests).toEqual(["google-ar"]);
  await expect(page.getByText("Highlighting is approximate here: this voice doesn't report when each word is spoken, so the times are estimated.")).toBeVisible();
  await page.locator("audio").evaluate(
    (a: HTMLAudioElement) =>
      new Promise<void>((resolve) => {
        a.addEventListener("seeked", () => resolve(), { once: true });
        a.currentTime = 3.0; // second sentence starts at 2.8 s
      }),
  );
  const region = page.getByRole("region", { name: "Text being read" }).first();
  await expect(region.locator('[data-state="current"]')).toHaveText("هذا اختبار لصوت جوجل.");
  await expect(region.locator("[data-current]")).toHaveText("هذا");
});

test("Arabic interface: the Google voice and its notes are translated", async ({ page }) => {
  await openFresh(page);
  await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
  await page.goto("/");
  await page.getByRole("button", { name: "تصفّح كل الأصوات" }).click();
  const dlg = page.getByRole("dialog", { name: "اختر صوتاً" });
  await dlg.getByRole("button", { name: /^العربية/ }).click();
  const section = dlg.getByRole("region", { name: "أصوات عربية أخرى" });
  await section.getByRole("button", { name: /^استخدام جوجل/ }).click();
  await expect(page.getByRole("group", { name: "الصوت الحالي" })).toContainText("جوجل");
  await page.locator("#editor").fill(TEXT);
  await expect(page.getByText("يُرسل نصك إلى خدمة النطق من Google لإنشاء الصوت.")).toBeVisible();
});

test("no accessibility violations with the Google voice selected", async ({ page }) => {
  await openFresh(page);
  const dlg = await openBrowser(page);
  await dlg.getByRole("button", { name: /^Arabic/ }).click();
  await expect(dlg.getByRole("region", { name: "More Arabic voices" })).toBeVisible();
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.nodes.length})`), label).toEqual([]);
  };
  await scan("Arabic page with More Arabic voices");
  await dlg.getByRole("region", { name: "More Arabic voices" }).getByRole("button", { name: /^Use Google\./ }).click();
  await expect(dlg).toBeHidden();
  await scan("studio with fixed speed and pitch");
});
