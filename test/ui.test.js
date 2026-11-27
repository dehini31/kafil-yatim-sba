"use strict";
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const {chromium} = require("playwright");
const {startApp, PASSWORD} = require("./helpers");

let app, browser, photoFile;
const shots = process.env.SHOTS_DIR;

before(async () => {
  app = await startApp();
  browser = await chromium.launch({args: ["--no-sandbox"]});
  photoFile = path.join(app.dir, "portrait.jpg");
  await sharp({create: {width: 700, height: 900, channels: 3, background: "#6b8f71"}}).jpeg().toFile(photoFile);
});
after(async () => { await browser.close(); await app.close(); });

const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const [label, viewport] of [["mobile", {width: 360, height: 740}], ["desktop", {width: 1280, height: 800}]]) {
  test(`admin flow in the browser (${label}): login, create & publish, downloads, disable`, async () => {
    const context = await browser.newContext({viewport, acceptDownloads: true});
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(app.origin + "/kafil/admin/");
    await page.fill("input[name=email]", "admin@example.test");
    await page.fill("input[name=password]", "bad-password-xx");
    await page.click("button[type=submit]");
    await page.getByRole("alert").waitFor();
    await page.fill("input[name=password]", PASSWORD);
    await page.click("button[type=submit]");
    await page.getByText("+ Nouvel adhérent").click();
    const name = `عضو واجهة ${label} (TEST)`;
    await page.fill("input[name=fullName]", name);
    await page.fill("input[name=role]", "مسؤول الإعلام");
    await page.fill("input[name=expiresAt]", "2099-12-31");
    await page.setInputFiles("input[name=photo]", photoFile);
    await page.getByRole("button", {name: "Créer et publier"}).click();
    const dialog = page.locator("dialog[data-detail]");
    await dialog.getByText("Publiée").first().waitFor({timeout: 20000});
    await dialog.getByText("PDF prêt").waitFor({timeout: 20000});
    // preview iframe is the same document as the PDF
    const frame = dialog.frameLocator("iframe");
    await frame.locator("#name").waitFor();
    assert.equal(await frame.locator("#name").innerText(), name);
    const link = dialog.locator(".link");
    const url = await link.innerText();
    assert.match(url, /\/members\/[a-z0-9]{8}\/$/);
    const [qr] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("link", {name: "Télécharger le QR"}).click()]);
    assert.match(qr.suggestedFilename(), /-qr\.png$/);
    const [pdf] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("link", {name: "Télécharger le PDF"}).click()]);
    assert.match(pdf.suggestedFilename(), /\.pdf$/);
    if (shots) await page.screenshot({path: path.join(shots, `admin-${label}.png`), fullPage: false});
    if (label === "mobile") assert.ok(await noHorizontalScroll(page), "admin has no horizontal scroll at 360px");
    // change print size in the UI and see the preview resize
    await dialog.locator("input[name=widthMm]").fill("85.6");
    await dialog.locator("input[name=heightMm]").fill("54");
    await dialog.locator("select[name=orientation]").selectOption("landscape");
    await page.waitForTimeout(900);
    await dialog.getByText("Format 85.6 × 54 mm").waitFor();
    await dialog.getByText("Désactiver").click();
    await dialog.getByText("Désactivé").first().waitFor();
    await dialog.getByText("Publiée").first().waitFor({timeout: 20000});
    await page.goto(url);
    await page.getByText("بطاقة غير سارية").waitFor();
    assert.deepEqual(errors.filter(e => !/401/.test(e)), []);
    await context.close();
  });
}

test("public card at 320px, 360px and desktop", async () => {
  const c = await app.service.create({fullName: "فاطمة الزهراء بن عيسى (TEST)", role: "مسؤولة التواصل", expiresAt: "2099-12-31", memberNumber: "X1", photo: "data:image/jpeg;base64," + fs.readFileSync(photoFile).toString("base64")}, "test");
  await app.service.pipeline(c.id).catch(() => {});
  for (const [w, h] of [[320, 640], [360, 740], [1280, 800]]) {
    const context = await browser.newContext({viewport: {width: w, height: h}});
    const page = await context.newPage();
    await page.goto(c.url);
    await page.getByText("بطاقة سارية").waitFor();
    assert.ok(await noHorizontalScroll(page), `no horizontal scroll at ${w}px`);
    assert.ok(await page.locator(".portrait").isVisible());
    assert.equal(await page.locator("h1").innerText(), "فاطمة الزهراء بن عيسى (TEST)");
    // empty contacts are hidden; only the national website is configured
    const items = await page.locator(".contact-grid .contact").count();
    assert.equal(items, 1);
    await page.getByRole("button", {name: "نسخ رابط البطاقة"}).waitFor();
    await page.getByRole("button", {name: "رمز QR"}).click();
    assert.ok(await page.locator("#qr-image").isVisible());
    if (shots) await page.screenshot({path: path.join(shots, `public-${w}.png`), fullPage: true});
    await context.close();
  }
});
