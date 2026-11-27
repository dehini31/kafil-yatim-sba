"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {id: newId, randomSlug, validSlug, validDate, statusOf, today, sha} = require("./util");
const photo = require("./photo");
const site = require("./site");
const print = require("./print");

const fail = (status, message) => Object.assign(new Error(message), {status});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const cleanLines = (value, max) => String(value ?? "").replace(/\r/g, "").split("\n").map(l => clean(l, 80)).filter(Boolean).join("\n").slice(0, max);

class Service {
  constructor({config, store, publisher, pdf, fetchImpl = fetch}) {
    Object.assign(this, {config, store, publisher, pdf, fetchImpl});
    this.chain = Promise.resolve();
    this.previews = new Map();
    // A crash can leave work half-done: surface it as a failure the admin can retry.
    for (const m of store.db.members) {
      if (["saving", "publishing"].includes(m.publication.state)) {
        m.publication = {...m.publication, state: "failed", error: "انقطع النشر (إعادة تشغيل الخادم). أعد المحاولة."};
        m.pdf = {state: "none"};
      } else if (m.pdf.state === "building") {
        m.pdf = {state: "failed", error: "انقطع الإنشاء. استخدم «إعادة إنشاء PDF»."};
      }
    }
    store.save();
    if (store.migrated) this.publishAll(); // new default contacts reach every public page
  }

  enqueue(task) {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => {});
    return run;
  }
  get db() { return this.store.db; }
  find(idOrSlug) {
    const m = this.db.members.find(x => x.id === idOrSlug);
    if (!m) throw fail(404, "العضو غير موجود.");
    return m;
  }
  pageUrl(m) { return new URL(`members/${m.slug}/`, this.config.baseUrl).href; }
  photoFile(m) { return path.join(this.store.dir, "photos", m.id + ".jpg"); }
  pdfFile(m) { return path.join(this.store.dir, "pdf", m.id + ".pdf"); }
  photoBuffer(m) { return fs.existsSync(this.photoFile(m)) ? fs.readFileSync(this.photoFile(m)) : null; }

  view(m) {
    return {
      id: m.id, slug: m.slug, fullName: m.fullName, role: m.role, memberNumber: m.memberNumber || "",
      expiresAt: m.expiresAt, disabled: m.disabled, status: statusOf(m), url: this.pageUrl(m),
      publication: m.publication, pdf: m.pdf, print: m.print, hasPhoto: !!this.photoBuffer(m),
      verified: !!m.verifiedUrl, createdAt: m.createdAt, updatedAt: m.updatedAt
    };
  }
  list({q = "", status = ""} = {}) {
    const needle = clean(q, 80).toLowerCase();
    return this.db.members
      .filter(m => !needle || m.fullName.toLowerCase().includes(needle) || (m.memberNumber || "").toLowerCase().includes(needle))
      .filter(m => !status || statusOf(m) === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(m => this.view(m));
  }

  fields(input, {partial = false} = {}) {
    const out = {};
    if (!partial || "fullName" in input) {
      out.fullName = clean(input.fullName, 120);
      if (out.fullName.length < 2) throw fail(422, "الاسم واللقب مطلوبان.");
    }
    if (!partial || "role" in input) {
      out.role = clean(input.role, 120);
      if (out.role.length < 2) throw fail(422, "المنصب داخل الجمعية مطلوب.");
    }
    if (!partial || "expiresAt" in input) {
      if (!validDate(input.expiresAt)) throw fail(422, "تاريخ الانتهاء غير صالح (سنة-شهر-يوم).");
      out.expiresAt = input.expiresAt;
    }
    if (!partial || "memberNumber" in input) out.memberNumber = clean(input.memberNumber, 40);
    return out;
  }
  checkNumber(number, exceptId) {
    if (number && this.db.members.some(m => m.id !== exceptId && m.memberNumber === number)) {
      throw fail(409, "رقم العضوية موجود مسبقاً.");
    }
  }

  async create(input, actor) {
    const requestId = clean(input.requestId, 80);
    if (requestId) {
      const dup = this.db.members.find(m => m.requestId === requestId);
      if (dup) return this.view(dup); // same click twice / retried request: no duplicate
    }
    const data = this.fields(input);
    this.checkNumber(data.memberNumber);
    const image = await photo.normalize(input.photo);
    let slug = input.slug ? clean(input.slug, 64).toLowerCase() : "";
    if (slug && !validSlug(slug)) throw fail(422, "معرّف الرابط غير صالح أو محجوز.");
    if (!slug) do slug = randomSlug(); while (this.db.members.some(m => m.slug === slug));
    if (this.db.members.some(m => m.slug === slug)) throw fail(409, "معرّف الرابط مستخدم مسبقاً.");
    const now = new Date().toISOString();
    const m = {
      id: newId(), slug, ...data, disabled: false, requestId, print: null, createdAt: now, updatedAt: now,
      publication: {state: "saving", error: null, step: "جارٍ الحفظ"}, pdf: {state: "building"}, verifiedUrl: null
    };
    fs.writeFileSync(this.photoFile(m), image);
    this.db.members.push(m);
    this.store.audit(actor, "member.create", {member: m.id});
    this.store.save();
    this.start(m.id);
    return this.view(m);
  }

  async update(idOrSlug, input, actor) {
    const m = this.find(idOrSlug);
    const data = this.fields(input, {partial: true});
    if ("memberNumber" in data) this.checkNumber(data.memberNumber, m.id);
    Object.assign(m, data); // slug is never touched: printed QR codes stay valid
    if (input.photo) fs.writeFileSync(this.photoFile(m), await photo.normalize(input.photo));
    return this.touch(m, "member.update", actor);
  }
  async renew(id, expiresAt, actor) {
    const m = this.find(id);
    if (!validDate(expiresAt)) throw fail(422, "تاريخ الانتهاء غير صالح.");
    if (expiresAt < today()) throw fail(422, "يجب أن يكون التاريخ الجديد في المستقبل.");
    m.expiresAt = expiresAt;
    return this.touch(m, "member.renew", actor);
  }
  async setDisabled(id, disabled, actor) {
    const m = this.find(id);
    m.disabled = disabled;
    return this.touch(m, disabled ? "member.disable" : "member.enable", actor);
  }
  touch(m, action, actor) {
    m.updatedAt = new Date().toISOString();
    m.publication = {state: "saving", error: null, step: "جارٍ الحفظ"};
    m.pdf = {state: "building"}; // the previous PDF is outdated; do not offer it
    this.store.audit(actor, action, {member: m.id});
    this.store.save();
    this.start(m.id);
    return this.view(m);
  }
  retry(id, actor) {
    const m = this.find(id);
    if (["saving", "publishing"].includes(m.publication.state)) throw fail(409, "النشر جارٍ بالفعل.");
    this.store.audit(actor, "member.retry", {member: m.id});
    m.publication = {state: "saving", error: null, step: "جارٍ الحفظ"};
    m.pdf = {state: "building"};
    this.store.save();
    this.start(m.id);
    return this.view(m);
  }
  start(id) {
    this.pipeline(id).catch(error => console.error("pipeline", error));
  }

  // Save -> publish -> verify the public URL -> QR from the verified link -> initial PDF.
  async pipeline(id) {
    const m = this.find(id);
    try {
      const rev = await this.enqueue(async () => {
        m.publication = {state: "publishing", error: null, step: "جارٍ النشر", startedAt: new Date().toISOString()};
        this.store.save();
        return this.publishMember(m);
      });
      await this.verifyPage(m, rev);
      m.verifiedUrl = this.pageUrl(m);
      m.publication = {state: "published", error: null, step: "منشورة", rev, publishedAt: new Date().toISOString()};
      this.store.save();
    } catch (error) {
      m.publication = {state: "failed", error: error.message, step: "فشل", failedAt: new Date().toISOString()};
      m.pdf = {state: "none"};
      this.store.save();
      return;
    }
    await this.buildPdf(m);
  }

  filesFor(members) {
    const files = {};
    const revs = {};
    for (const m of members) {
      const image = this.photoBuffer(m);
      const page = site.renderPage(m, this.db.settings, image, this.config.baseUrl);
      files[`members/${m.slug}/index.html`] = page.html;
      revs[m.slug] = page.rev;
      files[`assets/members/${m.slug}.jpg`] = this.db.settings.publicFields.photo && image ? image : null;
    }
    files["data/members.json"] = site.json(site.registry(this.db.members));
    files["data/contacts.json"] = site.contactsFile(this.db.settings);
    return {files, revs};
  }
  async publishMember(m) {
    const {files, revs} = this.filesFor([m]);
    await this.publisher.publish({files, message: `Carte ${m.slug} : publication`});
    return revs[m.slug];
  }

  async fetchText(url) {
    const response = await this.fetchImpl(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now(), {cache: "no-store", redirect: "follow"});
    return {ok: response.ok, status: response.status, text: response.ok ? await response.text() : ""};
  }
  async waitFor(check, what) {
    const deadline = Date.now() + this.config.verifyTimeoutMs;
    let last = "";
    for (;;) {
      try { last = await check(); if (!last) return; } catch (error) { last = error.message; }
      if (Date.now() > deadline) throw new Error(`${what} : غير متاحة على العنوان العام (${last}).`);
      await sleep(this.config.verifyIntervalMs);
    }
  }
  // The URL must really serve this member's current card before we hand out a QR for it.
  verifyPage(m, rev) {
    const url = this.pageUrl(m);
    return this.waitFor(async () => {
      const page = await this.fetchText(url);
      if (!page.ok) return `HTTP ${page.status}`;
      if (!page.text.includes(`data-member="${m.slug}"`) || !page.text.includes(`name="card-rev" content="${rev}"`)) return "المحتوى بانتظار النشر";
      const reg = await this.fetchText(new URL("data/members.json", this.config.baseUrl).href);
      const entry = reg.ok && JSON.parse(reg.text).find(e => e.slug === m.slug);
      if (!entry || entry.active !== !m.disabled || entry.expiresAt !== m.expiresAt) return "السجل بانتظار النشر";
      return "";
    }, "صفحة البطاقة");
  }

  printConfig(m) { return print.normalizeConfig(m.print, this.db.settings.printDefaults); }
  async buildPdf(m, actor) {
    try {
      if (!m.verifiedUrl) throw fail(409, "يجب نشر البطاقة أولاً.");
      const config = this.printConfig(m);
      const model = print.makeModel({member: m, config, publicUrl: m.verifiedUrl, photoBuffer: this.photoBuffer(m)});
      const {pdf, layout} = await this.pdf.render(model);
      if (!layout.fits) {
        m.pdf = {state: "blocked", issues: layout.issues, config};
      } else {
        fs.writeFileSync(this.pdfFile(m), pdf);
        m.pdf = {state: "ready", generatedAt: new Date().toISOString(), issues: layout.issues, config, bytes: pdf.length, qrMm: layout.qrMm, moduleMm: layout.moduleMm};
      }
      if (actor) this.store.audit(actor, "member.pdf", {member: m.id});
    } catch (error) {
      m.pdf = {state: "failed", error: error.message};
    }
    this.store.save();
    return this.view(m);
  }
  regeneratePdf(id, actor) { return this.enqueue(() => this.buildPdf(this.find(id), actor)); }
  async setPrint(id, config, actor) {
    const m = this.find(id);
    m.print = config === null ? null : print.normalizeConfig(config, this.db.settings.printDefaults);
    this.store.audit(actor, "member.print-config", {member: m.id});
    return this.buildPdf(m, actor);
  }

  // Preview = the exact HTML document the PDF is printed from.
  async preview({memberId, draft = {}, config}) {
    let member, url;
    if (memberId) {
      const m = this.find(memberId);
      member = {...m, ...this.fields({...m, ...draft}, {partial: true})};
      url = this.pageUrl(m);
    } else {
      member = {...this.fields({role: "—", expiresAt: today(), ...draft, fullName: draft.fullName || "—"}), };
      url = new URL("members/apercu/", this.config.baseUrl).href;
    }
    const cfg = print.normalizeConfig(config ?? (memberId ? member.print : null), this.db.settings.printDefaults);
    const image = draft.photo ? await photo.normalize(draft.photo) : memberId ? this.photoBuffer(this.find(memberId)) : null;
    const model = print.makeModel({member, config: cfg, publicUrl: url, photoBuffer: image});
    const html = print.buildHtml(model);
    const layout = model.layout;
    const token = newId();
    this.previews.set(token, {html, at: Date.now()});
    for (const [key, value] of this.previews) if (Date.now() - value.at > 10 * 60e3 || this.previews.size > 50) this.previews.delete(key);
    const size = print.pageSize(cfg);
    return {token, layout, widthMm: size.w, heightMm: size.h};
  }

  getSettings() { return this.db.settings; }
  updateSettings(input, actor) {
    const current = this.db.settings;
    const next = {...current};
    if (input.contacts) {
      next.contacts = {};
      for (const key of Object.keys(current.contacts)) {
        const multi = key === "hours" || key === "nationalPhones";
        next.contacts[key] = multi ? cleanLines(input.contacts[key], 600) : clean(input.contacts[key] ?? "", 300);
      }
      if (next.contacts.nationalWebsite && !/^https:\/\//.test(next.contacts.nationalWebsite)) throw fail(422, "الموقع الوطني : رابط https مطلوب.");
    }
    if (input.publicFields) {
      next.publicFields = {};
      for (const key of Object.keys(current.publicFields)) next.publicFields[key] = !!input.publicFields[key];
    }
    if (input.printDefaults) next.printDefaults = print.normalizeConfig(input.printDefaults, current.printDefaults);
    const republish = JSON.stringify([next.contacts, next.publicFields]) !== JSON.stringify([current.contacts, current.publicFields]);
    this.db.settings = next;
    this.store.audit(actor, "settings.update");
    this.store.save();
    if (republish) this.publishAll();
    return next;
  }
  // Settings that change public pages (contacts, public fields) re-render every card; URLs do not change.
  publishAll() {
    const state = this.db.settingsPublication = {state: "publishing", error: null, at: new Date().toISOString()};
    this.store.save();
    const run = async () => {
      try {
        const {files, revs} = await this.enqueue(async () => {
          const out = this.filesFor(this.db.members);
          await this.publisher.publish({files: out.files, message: "Mise à jour des réglages publics"});
          return out;
        });
        for (const m of this.db.members) await this.verifyPage(m, revs[m.slug]);
        for (const m of this.db.members) { m.verifiedUrl = this.pageUrl(m); m.publication = {...m.publication, state: "published", rev: revs[m.slug], error: null, step: "منشورة"}; }
        this.db.settingsPublication = {state: "published", error: null, at: new Date().toISOString()};
      } catch (error) {
        this.db.settingsPublication = {state: "failed", error: error.message, at: new Date().toISOString()};
      }
      this.store.save();
    };
    this.settingsJob = run();
    return state;
  }
}
module.exports = {Service, fail};
