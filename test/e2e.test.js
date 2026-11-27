"use strict";
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {execFileSync} = require("node:child_process");
const {PNG} = require("pngjs");
const jsQR = require("jsqr");
const {startApp, client, photoDataUrl, waitFor} = require("./helpers");

let app, api, photo;
const created = {};

function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return result && result.data;
}
function decodePdf(file, dpi = 300) {
  const out = file.replace(/\.pdf$/, "");
  execFileSync("pdftoppm", ["-r", String(dpi), "-png", "-singlefile", file, out]);
  return decodePng(fs.readFileSync(out + ".png"));
}
function pdfSize(file) {
  const text = execFileSync("pdfinfo", ["-box", file]).toString();
  const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(text);
  const mm = pt => Math.round(pt * 25.4 / 72 * 100) / 100;
  return {w: mm(+w), h: mm(+h), pages: +/Pages:\s+(\d+)/.exec(text)[1]};
}
const published = id => waitFor(async () => {
  const {json} = await api.call("GET", "/api/members/" + id);
  const m = json.member;
  return m.publication.state === "failed" || (m.publication.state === "published" && !["none", "building"].includes(m.pdf.state)) ? m : null;
});
const registryEntry = () => JSON.parse(site("data/members.json")).find(e => e.slug === created.slug);
const site = file => fs.readFileSync(path.join(app.dir, "site", file));

before(async () => {
  app = await startApp();
  api = client(app.origin);
  photo = await photoDataUrl();
});
after(async () => { await app.close(); });

test("administration endpoints refuse unauthenticated and forged requests", async () => {
  const anon = client(app.origin);
  for (const [method, url, body] of [["GET", "/api/members"], ["POST", "/api/members", {fullName: "x"}], ["PUT", "/api/settings", {}],
    ["GET", "/api/settings"], ["POST", "/api/members/00000000-0000-4000-8000-000000000000/disable"], ["POST", "/api/print-preview", {}]]) {
    const r = await anon.call(method, url, body);
    assert.equal(r.status, 401, `${method} ${url}`);
  }
  assert.equal((await anon.login("admin@example.test", "wrong-password-123")).status, 401);
  assert.equal((await anon.login("nobody@example.test", "whatever-123456")).status, 401);
  // cookie that was never issued
  const forged = await fetch(app.origin + "/api/members", {headers: {cookie: "kafil_sid=forged"}});
  assert.equal(forged.status, 401);
  // brute force lockout
  for (let i = 0; i < 6; i++) await anon.login("victim@example.test", "bad-guess-" + i);
  assert.equal((await anon.login("victim@example.test", "bad-guess-x")).status, 429);
});

test("login, then state-changing calls require the CSRF header", async () => {
  const ok = await api.login();
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const noHeader = await api.call("POST", "/api/members", {fullName: "x"}, {csrf: false});
  assert.equal(noHeader.status, 403);
});

test("create and publish: URL, page, QR scan, initial PDF", async () => {
  const r = await api.call("POST", "/api/members", {
    requestId: "req-1", fullName: "محمد الأمين بن عبد القادر (TEST)", role: "رئيس المكتب الولائي", expiresAt: "2099-12-31", memberNumber: "TEST-0001", photo
  });
  assert.equal(r.status, 202);
  const id = r.json.member.id;
  assert.equal(r.json.member.publication.state, "saving");
  const member = await published(id);
  created.id = id; created.slug = member.slug; created.url = member.url;
  assert.equal(member.publication.state, "published", member.publication.error);
  assert.equal(member.pdf.state, "ready", JSON.stringify(member.pdf));
  assert.match(member.slug, /^[a-z0-9]{8}$/);
  assert.equal(member.url, `${app.config.baseUrl}members/${member.slug}/`);

  // the public page really serves this member
  const page = await (await fetch(member.url)).text();
  assert.ok(page.includes("محمد الأمين بن عبد القادر (TEST)"));
  assert.ok(page.includes("رئيس المكتب الولائي"));
  assert.ok(page.includes("31/12/2099"));
  assert.ok(page.includes('data-state="active"'));
  assert.ok(!page.includes("TEST-0001"), "member number is not public by default");

  // QR: decode the downloaded PNG, then "scan" -> open the encoded URL
  const qr = await api.call("GET", `/api/members/${id}/qr.png`, undefined, {raw: true});
  assert.equal(qr.status, 200);
  const decoded = decodePng(Buffer.from(await qr.arrayBuffer()));
  assert.equal(decoded, member.url, "QR encodes only the public URL");
  const scanned = await (await fetch(decoded)).text();
  assert.ok(scanned.includes("محمد الأمين بن عبد القادر (TEST)"));
  const svg = await api.call("GET", `/api/members/${id}/qr.svg`, undefined, {raw: true});
  assert.equal(svg.status, 200);

  // idempotent create: same request id returns the same member, no duplicate
  const again = await api.call("POST", "/api/members", {requestId: "req-1", fullName: "dup", role: "dup", expiresAt: "2099-12-31", photo});
  assert.equal(again.json.member.id, id);
  assert.equal(app.store.db.members.length, 1);

  // public registry exposes nothing but slug / validity
  const registry = JSON.parse(site("data/members.json"));
  assert.deepEqual(registry, [{slug: member.slug, active: true, expiresAt: "2099-12-31"}]);
  assert.ok(fs.existsSync(path.join(app.dir, "site", `assets/members/${member.slug}.jpg`)));
  // list + search + filters
  assert.equal((await api.call("GET", "/api/members?q=TEST-0001")).json.members.length, 1);
  assert.equal((await api.call("GET", "/api/members?q=%D9%85%D8%AD%D9%85%D8%AF")).json.members.length, 1);
  assert.equal((await api.call("GET", "/api/members?q=zzz")).json.members.length, 0);
  assert.equal((await api.call("GET", "/api/members?status=expired")).json.members.length, 0);
  assert.equal((await api.call("GET", "/api/members?status=active")).json.members.length, 1);
});

test("PDF 100 x 135 mm: real size, Arabic, QR decodable from the PDF", async () => {
  const pdf = await api.call("GET", `/api/members/${created.id}/card.pdf`, undefined, {raw: true});
  assert.equal(pdf.status, 200);
  const file = path.join(app.dir, "card.pdf");
  fs.writeFileSync(file, Buffer.from(await pdf.arrayBuffer()));
  const size = pdfSize(file);
  assert.deepEqual([size.w, size.h, size.pages], [100, 135, 1]);
  assert.equal(decodePdf(file), created.url, "QR decoded from the PDF at 300 dpi");
  assert.equal(decodePdf(file, 150), created.url, "still decodes at 150 dpi");
  assert.match(execFileSync("pdffonts", [file]).toString(), /Tajawal/);
});

test("PDF in another size/orientation, field selection and long names", async () => {
  const id = created.id;
  const set = cfg => api.call("PUT", `/api/members/${id}/print`, {config: cfg});
  // 85.6 x 54 landscape without photo and number
  let r = await set({widthMm: 85.6, heightMm: 54, orientation: "landscape", fields: {photo: false, number: false}});
  assert.equal(r.json.member.pdf.state, "ready", JSON.stringify(r.json.member.pdf));
  let file = path.join(app.dir, "land.pdf");
  fs.writeFileSync(file, Buffer.from(await (await api.call("GET", `/api/members/${id}/card.pdf`, undefined, {raw: true})).arrayBuffer()));
  assert.deepEqual([pdfSize(file).w, pdfSize(file).h], [85.6, 54]);
  assert.equal(decodePdf(file), created.url);
  // hiding fields must not leave blank gaps and printing must not publish: page unchanged
  const page = await (await fetch(created.url)).text();
  assert.ok(page.includes("31/12/2099"));
  // 120 x 120 square with number printed
  r = await set({widthMm: 120, heightMm: 120, orientation: "portrait", fields: {number: true}});
  assert.equal(r.json.member.pdf.state, "ready");
  file = path.join(app.dir, "sq.pdf");
  fs.writeFileSync(file, Buffer.from(await (await api.call("GET", `/api/members/${id}/card.pdf`, undefined, {raw: true})).arrayBuffer()));
  assert.deepEqual([pdfSize(file).w, pdfSize(file).h], [120, 120]);
  assert.equal(decodePdf(file), created.url);
  // too small for the content: blocked and explained, never a clipped print
  r = await set({widthMm: 45, heightMm: 45, orientation: "portrait"});
  assert.equal(r.json.member.pdf.state, "blocked");
  assert.ok(r.json.member.pdf.issues.some(i => i.blocking));
  // out of range
  assert.equal((await set({widthMm: 5, heightMm: 5})).status, 422);
  // preview uses the same document and reports the same issues
  const pv = await api.call("POST", "/api/print-preview", {memberId: id, config: {widthMm: 45, heightMm: 45}});
  assert.equal(pv.json.layout.fits, false);
  const html = await api.call("GET", "/api/print-preview/" + pv.json.token);
  assert.equal(html.status, 200);
  assert.match(html.text, /@page\{size:45mm 45mm/);
  // long name still fits at default size
  r = await api.call("POST", "/api/members", {fullName: "عبد الرحمن محمد الأمين بن عبد القادر بوزيان الحسني التلمساني الوهراني الغزواتي", role: "أمين المال المكلف بالشؤون الاجتماعية والتنسيق مع المكاتب البلدية", expiresAt: "2099-01-01", photo});
  const long = await published(r.json.member.id);
  assert.equal(long.pdf.state, "ready", JSON.stringify(long.pdf));
  // restore default for later tests
  await set(null);
});

test("renewal and edits keep the same URL and the same QR", async () => {
  const before = await (await api.call("GET", `/api/members/${created.id}/qr.png`, undefined, {raw: true})).arrayBuffer();
  const r = await api.call("POST", `/api/members/${created.id}/renew`, {expiresAt: "2100-06-30"});
  assert.equal(r.status, 202);
  assert.equal(r.json.member.slug, created.slug);
  let m = await waitFor(async () => { const x = (await api.call("GET", "/api/members/" + created.id)).json.member; return x.publication.state === "published" && x.pdf.state === "ready" && x.expiresAt === "2100-06-30" ? x : null; });
  assert.equal(m.url, created.url);
  assert.ok((await (await fetch(created.url)).text()).includes("30/06/2100"));
  const edit = await api.call("PUT", `/api/members/${created.id}`, {fullName: "محمد الأمين (معدّل)", role: "نائب الرئيس", photo: await photoDataUrl("#335577")});
  assert.equal(edit.status, 200);
  m = await waitFor(async () => { const x = (await api.call("GET", "/api/members/" + created.id)).json.member; return x.publication.state === "published" && x.fullName.includes("معدّل") ? x : null; });
  assert.equal(m.slug, created.slug);
  const page = await (await fetch(created.url)).text();
  assert.ok(page.includes("نائب الرئيس") && page.includes("(معدّل)".replace(/[()]/g, "")));
  const after = await (await api.call("GET", `/api/members/${created.id}/qr.png`, undefined, {raw: true})).arrayBuffer();
  assert.ok(Buffer.from(before).equals(Buffer.from(after)), "QR bytes unchanged after renewal and edits");
  // past date refused on renew
  assert.equal((await api.call("POST", `/api/members/${created.id}/renew`, {expiresAt: "2001-01-01"})).status, 422);
});

test("disable and re-enable: the URL stays up with a clear status", async () => {
  await api.call("POST", `/api/members/${created.id}/disable`);
  await waitFor(async () => (await api.call("GET", "/api/members/" + created.id)).json.member.publication.state === "published"
    && registryEntry().active === false);
  const res = await fetch(created.url);
  assert.equal(res.status, 200);
  const page = await res.text();
  assert.ok(page.includes('data-state="disabled"') && page.includes("بطاقة غير سارية"));
  assert.equal((await api.call("GET", "/api/members?status=disabled")).json.members.length, 1);
  await api.call("POST", `/api/members/${created.id}/enable`);
  await waitFor(async () => registryEntry().active === true && (await (await fetch(created.url)).text()).includes('data-state="active"'));
});

test("expired cards stay reachable and say so", async () => {
  const r = await api.call("POST", "/api/members", {fullName: "عضو منتهي (TEST)", role: "عضو", expiresAt: "2020-01-01", photo});
  const m = await published(r.json.member.id);
  assert.equal(m.status, "expired");
  const page = await (await fetch(m.url)).text();
  assert.ok(page.includes('data-state="expired"') && page.includes("بطاقة منتهية الصلاحية"));
  assert.equal((await api.call("GET", "/api/members?status=expired")).json.members.length, 1);
});

test("publication failure keeps the record; retry does not duplicate", async () => {
  app.service.publisher.fail = new Error("panne simulée");
  const r = await api.call("POST", "/api/members", {requestId: "req-fail", fullName: "عضو تجريبي (TEST)", role: "عضو", expiresAt: "2099-01-01", photo});
  const id = r.json.member.id, slug = r.json.member.slug;
  const failed = await published(id);
  assert.equal(failed.publication.state, "failed");
  assert.match(failed.publication.error, /panne simulée/);
  assert.equal((await api.call("GET", `/api/members/${id}/qr.png`, undefined, {raw: true})).status, 409, "no QR before the URL is verified");
  assert.equal((await api.call("GET", "/api/members?q=TEST")).json.members.some(m => m.id === id), true);
  app.service.publisher.fail = null;
  const retry = await api.call("POST", `/api/members/${id}/publish`);
  assert.equal(retry.status, 202);
  const ok = await waitFor(async () => { const x = (await api.call("GET", "/api/members/" + id)).json.member; return x.publication.state === "published" && x.pdf.state === "ready" ? x : null; });
  assert.equal(ok.slug, slug, "same URL after retry");
  assert.equal(app.store.db.members.filter(m => m.slug === slug).length, 1);
  assert.equal((await api.call("GET", `/api/members/${id}/qr.png`, undefined, {raw: true})).status, 200);
});

test("verification failure (page never appears) is reported as a failure", async () => {
  const slow = await startApp({verifyTimeoutMs: 700, fetchImpl: async () => ({ok: false, status: 404, text: async () => ""})});
  const c = client(slow.origin);
  await c.login();
  const r = await c.call("POST", "/api/members", {fullName: "عضو (TEST)", role: "عضو", expiresAt: "2099-01-01", photo});
  const m = await waitFor(async () => { const x = (await c.call("GET", "/api/members/" + r.json.member.id)).json.member; return x.publication.state === "failed" ? x : null; });
  assert.match(m.publication.error, /صفحة البطاقة/);
  assert.equal((await c.call("GET", `/api/members/${m.id}/qr.png`, undefined, {raw: true})).status, 409);
  await slow.close();
});

test("settings: public fields control what is published; contacts are centralised", async () => {
  const s = (await api.call("GET", "/api/settings")).json.settings;
  const r = await api.call("PUT", "/api/settings", {
    contacts: {...s.contacts, phone: "+213 48 00 00 00", email: "bureau@example.test"},
    publicFields: {photo: false, role: false, expiry: false, memberNumber: true}
  });
  assert.equal(r.status, 200);
  await app.service.settingsJob;
  assert.equal(app.store.db.settingsPublication.state, "published", app.store.db.settingsPublication.error);
  const contacts = JSON.parse(site("data/contacts.json"));
  assert.equal(contacts.email, "bureau@example.test");
  assert.equal(contacts.facebook, "https://www.facebook.com/elyatim22/");
  assert.equal(contacts.address, "شارع ناصري عبد القادر، رقم 40، سيدي ياسين", "official default address");
  assert.equal(contacts.nationalEmail, "contact@kafilyatim.dz");
  const page = await (await fetch(created.url)).text();
  assert.ok(!page.includes("نائب الرئيس"), "role no longer public");
  assert.ok(!page.includes("30/06/2100"), "expiry date no longer public");
  assert.ok(page.includes("TEST-0001"), "member number now public");
  assert.ok(!fs.existsSync(path.join(app.dir, "site", `assets/members/${created.slug}.jpg`)), "photo file removed from the public site");
  // printing a field never publishes it: expiry still prints
  const m = (await api.call("GET", "/api/members/" + created.id)).json.member;
  assert.equal(m.pdf.state, "ready");
  assert.equal(m.pdf.config.fields.expiry, true);
  // restore
  await api.call("PUT", "/api/settings", {publicFields: {photo: true, role: true, expiry: true, memberNumber: false}});
  await app.service.settingsJob;
});

test("validation and security of inputs", async () => {
  const bad = body => api.call("POST", "/api/members", {fullName: "ok name", role: "role", expiresAt: "2099-01-01", photo, ...body});
  assert.equal((await bad({fullName: ""})).status, 422);
  assert.equal((await bad({expiresAt: "2099-02-30"})).status, 422);
  assert.equal((await bad({photo: "data:text/html;base64,PGI+"})).status, 422);
  assert.equal((await bad({photo: undefined})).status, 422);
  assert.equal((await bad({slug: "preview"})).status, 422);
  assert.equal((await bad({slug: "../x"})).status, 422);
  assert.equal((await bad({memberNumber: "TEST-0001"})).status, 409);
  const xss = await bad({fullName: '<img src=x onerror=alert(1)> (TEST)', slug: "xss-card"});
  const m = await published(xss.json.member.id);
  const page = await (await fetch(m.url)).text();
  assert.ok(!page.includes("<img src=x"), "name is escaped in the public page");
  assert.notEqual((await fetch(app.origin + "/kafil/..%2fdata/db.json")).status, 200);
  assert.notEqual((await fetch(app.origin + "/admin/..%2f..%2fpackage.json")).status, 200);
  const db = await fetch(app.origin + "/kafil/data/db.json");
  assert.notEqual(db.status, 200);
});

test("everything works under the /kafil sub-path of the domain", async () => {
  const c = client(app.origin);
  const login = await c.call("POST", "/kafil/api/login", {email: "admin@example.test", password: require("./helpers").PASSWORD});
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /Path=\/kafil\/admin;/);
  assert.equal((await c.call("GET", "/kafil/api/members")).status, 200);
  assert.equal((await c.call("GET", "/kafil/admin/api/members")).status, 200, "UI mount point for the API");
  assert.equal((await fetch(app.origin + "/kafil/admin/api/members")).status, 401);
  assert.equal((await c.call("GET", "/kafil/admin/")).status, 200);
  assert.equal((await c.call("GET", "/kafil/admin/admin.js")).status, 200);
  assert.equal((await c.call("GET", "/kafil/assets/logo.jpg", undefined, {raw: true})).status, 200);
  assert.equal((await c.call("GET", "/kafil/", undefined, {raw: true})).status, 200); // public home page
  assert.equal((await c.call("GET", "/kafil/members/preview/", undefined, {raw: true})).status, 200);
  assert.equal((await fetch(app.origin + "/kafil/api/members")).status, 401);
  const home = await (await fetch(app.origin + "/kafil/")).text();
  assert.ok(home.includes("بطاقات الأعضاء"));
});

test("recto layout: default prints role/expiry/QR only; name and photo are optional extras that still fit", async () => {
  const settings = (await api.call("GET", "/api/settings")).json.settings;
  assert.equal(settings.printDefaults.fields.photo, false);
  assert.equal(settings.printDefaults.fields.name, false);
  const pv = await api.call("POST", "/api/print-preview", {memberId: created.id});
  let html = (await api.call("GET", "/api/print-preview/" + pv.json.token)).text;
  const member = (await api.call("GET", "/api/members/" + created.id)).json.member;
  assert.ok(html.includes("صالحة إلى") && html.includes('id="qr"'));
  assert.ok(html.includes(member.role), "role is printed");
  assert.ok(!html.includes('class="ph"'), "no photo by default");
  assert.ok(!html.includes(member.fullName), "member name is not printed by default");
  // everything on, long name and long role, still fits at 100 x 135
  const draft = {fullName: "عبد الرحمن محمد الأمين بن عبد القادر بوزيان الحسني التلمساني الوهراني", role: "أمين المال المكلف بالشؤون الاجتماعية والتنسيق مع المكاتب البلدية"};
  const full = await api.call("POST", "/api/print-preview", {memberId: created.id, draft, config: {fields: {photo: true, name: true, number: true}}});
  assert.equal(full.json.layout.fits, true, JSON.stringify(full.json.layout));
  html = (await api.call("GET", "/api/print-preview/" + full.json.token)).text;
  assert.ok(html.includes('class="ph"'), "photo printed when enabled");
  assert.ok(html.includes("عبد الرحمن"), "name printed when enabled");
});


test("PDF works with a tiny photo (small Buffers are views on a shared pool)", async () => {
  const sharp = require("sharp");
  const tiny = await sharp({create: {width: 220, height: 220, channels: 3, background: "#336699"}}).jpeg({quality: 20}).toBuffer();
  const pdf = require("../server/pdf");
  const print = require("../server/print");
  const config = print.normalizeConfig({fields: {photo: true, name: true}}, app.store.db.settings.printDefaults);
  for (let i = 0; i < 3; i++) {
    const model = print.makeModel({member: {fullName: "عضو", role: "عضو", expiresAt: "2099-01-01"}, config, publicUrl: "https://dehini.com/kafil/members/abc12345/", photoBuffer: Buffer.from(tiny)});
    const out = await pdf.render(model);
    assert.ok(out.pdf.length > 1000 && out.layout.fits);
  }
});
