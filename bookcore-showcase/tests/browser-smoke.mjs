import assert from "node:assert/strict";
import { chromium, devices } from "playwright";

const URL = "https://bookcore-showcase.vercel.app";
const browser = await chromium.launch({ headless: true });
for (const mode of ["desktop", "mobile"]) {
  const context = await browser.newContext(
    mode === "mobile"
      ? { ...devices["iPhone 13"], locale: "ru-RU" }
      : { viewport: { width: 1440, height: 900 }, locale: "ru-RU" }
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const result = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 50000 });
  assert.equal(result.status(), 200, "HTTP must be 200");
  await page.locator("#phoneContent .service-row").first().waitFor();
  assert.match(await page.title(), /BOOKCORE STUDIO/i);

  await page.locator('.tab[data-preset="tattoo"]').click();
  assert.equal(await page.locator("#appPhone").getAttribute("data-industry"), "tattoo");
  assert.match(await page.locator("#phoneContent").innerText(), /NOIR TATTOO/);

  await page.locator('[data-role="master"]').click();
  assert.match(await page.locator("#phoneContent").innerText(), /Панель управления/);
  await page.locator('[data-master-tab="services"]').click();
  assert.match(await page.locator("#phoneContent").innerText(), /Активные услуги/);
  await page.locator('[data-master-tab="clients"]').click();
  assert.match(await page.locator("#phoneContent").innerText(), /Последние клиенты/);

  await page.locator('[data-role="client"]').click();
  await page.locator('.tab[data-preset="beauty"]').click();
  await page.locator('[data-service="1"]').click();
  await page.locator('[data-day="2"]').click();
  await page.locator('[data-time="13:00"]').click();
  await page.locator("#demoBook").click();
  await page.locator("#demoVeil.visible").waitFor();
  await page.locator("#dismissDemo").click();
  assert.equal(await page.locator("#demoVeil").isVisible(), false);

  if (mode === "mobile") {
    const widthInfo = await page.evaluate(() => ({
      window: window.innerWidth,
      content: document.documentElement.scrollWidth
    }));
    assert.ok(widthInfo.content <= widthInfo.window + 2,
      "Unexpected horizontal overflow on mobile: " + JSON.stringify(widthInfo));
  }
  assert.deepEqual(errors, [], "Browser JS errors: " + errors.join("; "));
  await page.screenshot({ path: "/tmp/showcase-" + mode + ".png", fullPage: true });
  console.log("BROWSER_PASS " + mode + ": switch themes, switch roles, master tabs, select appointment, demo confirmation");
  await context.close();
}
await browser.close();
