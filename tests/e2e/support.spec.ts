import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import jsQR from "jsqr";
import sharp from "sharp";
import { noHorizontalOverflow, openFresh } from "./helpers";

const USDT = "TLXRM9ZjDxtk6uEuMiKe3Ek8sHC8SQR845";
const XLAYER = "0x63223abFd548A93b04975b217E2f007be0cf4CFA";
const XKO = "XKO63223abFd548A93b04975b217E2f007be0cf4CFA";

async function openSupport(page: Page, locale: "en" | "ar" = "en") {
  await page.context().clearCookies();
  if (locale === "ar") await page.context().addCookies([{ name: "locale", value: "ar", url: "http://127.0.0.1" }]);
  await page.goto("/support");
}

const card = (page: Page, name: string) => page.getByRole("region", { name });

test("shows both methods with asset, network, warning, QR code and download before the address", async ({ page }) => {
  await openSupport(page);
  await expect(page).toHaveTitle("Support Listen to me");
  await expect(page.getByRole("heading", { level: 1, name: "Support Listen to me" })).toBeVisible();
  await expect(page.getByText(/never ask for your private keys, seed phrase or passwords/)).toBeVisible();

  const usdt = card(page, "USDT on Tron");
  await expect(usdt).toContainText("USDT (Tether)");
  await expect(usdt).toContainText("Tron (TRC20)");
  await expect(usdt).toContainText("Send only USDT on the Tron (TRC20) network");
  await expect(usdt.locator("code")).toHaveText(USDT);
  await expect(usdt.getByRole("link", { name: "Download QR code" })).toHaveAttribute("href", "/donate/listen-to-me-usdt-trc20-qr.png");

  const btc = card(page, "BTC on X Layer");
  await expect(btc).toContainText("Not a Bitcoin address");
  await expect(btc).toContainText("BTC, received as xBTC (OKX Wrapped BTC)");
  await expect(btc).toContainText("X Layer (by OKX)");
  await expect(btc).toContainText("This is not a Bitcoin network address");
  await expect(btc.locator("code").first()).toHaveText(XLAYER);
  await expect(btc.locator("code").nth(1)).toHaveText(XKO);

  for (const c of [usdt, btc]) {
    const img = c.getByRole("img", { name: /QR code of the .* receiving address/ });
    await expect(img).toBeVisible();
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    // Network and warning come before the address in reading order.
    const order = await c.evaluate((el) => {
      const text = el.textContent ?? "";
      return [text.indexOf("Network"), text.indexOf("lost permanently"), text.indexOf("Receiving address")];
    });
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  }
});

test("copy buttons put the exact address on the clipboard and confirm it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSupport(page);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  const usdt = card(page, "USDT on Tron");
  await usdt.getByRole("button", { name: "Copy address" }).click();
  await expect(usdt.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(usdt.getByRole("status")).toHaveText(/Address copied/);
  expect(await clipboard()).toBe(USDT);

  const btc = card(page, "BTC on X Layer");
  await btc.getByRole("button", { name: "Copy address" }).click();
  expect(await clipboard()).toBe(XLAYER);
  await btc.getByRole("button", { name: "Copy XKO format" }).click();
  expect(await clipboard()).toBe(XKO);

  // The confirmation goes away again.
  await expect(usdt.getByRole("button", { name: "Copy address" })).toBeVisible({ timeout: 5000 });
});

test("without clipboard access, the address is selected and the visitor is told to copy it manually", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } });
  });
  await openSupport(page);
  const usdt = card(page, "USDT on Tron");
  await usdt.getByRole("button", { name: "Copy address" }).click();
  await expect(usdt.getByRole("alert")).toHaveText(/Select the address and copy it manually/);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(USDT);
});

test("the downloaded QR code is a PNG that decodes to the address", async ({ page }) => {
  await openSupport(page);
  const btc = card(page, "BTC on X Layer");
  const [download] = await Promise.all([page.waitForEvent("download"), btc.getByRole("link", { name: "Download QR code" }).click()]);
  expect(download.suggestedFilename()).toBe("listen-to-me-btc-xlayer-qr.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  const { data, info } = await sharp(png).resize(800).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data).toBe(XLAYER);
});

test("FAQ answers open with the keyboard", async ({ page }) => {
  await openSupport(page);
  const question = page.getByText("Can I send BTC from a regular Bitcoin wallet?");
  const answer = page.getByText(/The BTC address is on X Layer, not on the Bitcoin network/);
  await expect(answer).toBeHidden();
  await question.focus();
  await page.keyboard.press("Enter");
  await expect(answer).toBeVisible();
});

test("Arabic: right-to-left page with the localized title and left-to-right addresses", async ({ page }) => {
  await openSupport(page, "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page).toHaveTitle("ادعم مشروع اسمعني");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ادعم مشروع اسمعني");
  const usdt = card(page, "USDT على شبكة Tron");
  await expect(usdt).toContainText("أرسل USDT على شبكة Tron");
  await expect(usdt.locator("code")).toHaveAttribute("dir", "ltr");
  await expect(usdt.locator("code")).toHaveText(USDT);
  await expect(card(page, "BTC على شبكة X Layer")).toContainText("ليس عنوان بيتكوين");
  await expect(usdt.getByRole("button", { name: "نسخ العنوان" })).toBeVisible();
});

test("header, footer and About lead to the support page", async ({ page }) => {
  await openFresh(page);
  await page.getByRole("banner").getByRole("link", { name: "Support the project" }).click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Support Listen to me");

  await page.getByRole("link", { name: "Back to the studio" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("contentinfo").getByRole("link", { name: "Support" }).click();
  await expect(page).toHaveURL(/\/support$/);

  await page.getByRole("contentinfo").getByRole("button", { name: "About", exact: true }).click();
  const about = page.getByRole("dialog", { name: "About Listen to me" });
  await expect(about.getByRole("heading", { name: "Support the project" })).toBeVisible();
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("button", { name: "About", exact: true }).click();
  await about.getByRole("link", { name: "Ways to support" }).click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(about).toBeHidden();
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("cards stack without horizontal scrolling in both languages", async ({ page }) => {
    for (const [locale, usdtName, btcName] of [
      ["en", "USDT on Tron", "BTC on X Layer"],
      ["ar", "USDT على شبكة Tron", "BTC على شبكة X Layer"],
    ] as const) {
      await openSupport(page, locale);
      await expect(page.getByRole("img", { name: /QR/ }).first()).toBeVisible();
      await noHorizontalOverflow(page);
      const first = (await card(page, usdtName).boundingBox())!;
      const second = (await card(page, btcName).boundingBox())!;
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    }
  });
});
