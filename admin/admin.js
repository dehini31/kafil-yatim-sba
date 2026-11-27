"use strict";

const app = document.getElementById("app");
const ROOT = new URL("../", location.href).pathname; // works under any sub-path, e.g. /kafil/
const API = new URL("api", location.href).pathname.replace(/\/$/, ""); // /kafil/admin/api
const ASSETS = ROOT + "assets/";
const L = {
  status: {active: "ساري", expired: "منتهي", disabled: "معطّل"},
  pub: {saving: "جارٍ الحفظ", publishing: "جارٍ النشر", published: "منشورة", failed: "فشل"},
  pdf: {none: "PDF : —", building: "جارٍ إنشاء PDF", ready: "PDF جاهز", blocked: "PDF محجوب", failed: "PDF : فشل"}
};
const PRINT_FIELDS = [
  ["logo", "الشعار", null], ["association", "اسم الجمعية", null], ["office", "المكتب الولائي", null],
  ["photo", "الصورة", "photo"], ["name", "الاسم الكامل", "always"], ["role", "المنصب", "role"],
  ["expiry", "تاريخ الانتهاء", "expiry"], ["number", "رقم العضوية", "memberNumber"], ["qr", "رمز QR", null]
];
let state = {me: null, members: [], settings: null, q: "", status: "", tab: "members", timer: null};

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "value") node.value = value;
    else if (key === "style") node.style.cssText = value; // CSSOM: allowed by the page CSP, unlike a style attribute
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(child));
  return node;
}
const badge = (kind, text) => h("span", {class: "badge b-" + kind}, text);

async function api(method, url, data) {
  const response = await fetch(API + url, {
    method, credentials: "same-origin",
    headers: {"content-type": "application/json", "x-requested-with": "kafil-admin"},
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && url !== "/login") { state.me = null; render(); throw new Error(body.error || "انتهت الجلسة."); }
  if (!response.ok) throw new Error(body.error || "خطأ " + response.status);
  return body;
}
function notify(container, kind, message) {
  container.replaceChildren(h("div", {class: "notice " + kind, role: kind === "err" ? "alert" : "status"}, message));
}

async function readPhoto(file) {
  // Downscale in the browser to keep uploads light; the server re-encodes and validates anyway.
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = h("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/* ---------- login ---------- */
function renderLogin() {
  const msg = h("div");
  const form = h("form", {class: "card login", onsubmit: async event => {
    event.preventDefault();
    try {
      state.me = await api("POST", "/login", {email: form.email.value, password: form.password.value});
      await boot();
    } catch (error) { notify(msg, "err", error.message); }
  }},
  h("div", {class: "row"}, h("img", {src: ASSETS + "logo.jpg", alt: "", width: 48, height: 48}), h("h2", {}, "الإدارة")),
  h("p", {class: "muted"}, "كافل اليتيم · سيدي بلعباس"),
  h("label", {class: "field"}, "البريد الإلكتروني", h("input", {type: "email", name: "email", required: true, autocomplete: "username"})),
  h("label", {class: "field"}, "كلمة المرور", h("input", {type: "password", name: "password", required: true, autocomplete: "current-password"})),
  h("button", {class: "btn primary", type: "submit"}, "تسجيل الدخول"), msg);
  app.replaceChildren(form);
}

/* ---------- shell ---------- */
function render() {
  if (!state.me) return renderLogin();
  const tab = (id, label) => h("button", {class: "tab", "aria-current": String(state.tab === id), onclick: () => { state.tab = id; render(); if (id === "settings") loadSettings(); }}, label);
  app.replaceChildren(
    h("header", {class: "top"}, h("img", {src: ASSETS + "logo.jpg", alt: ""}), h("h1", {}, "كافل اليتيم · سيدي بلعباس"),
      h("nav", {}, tab("members", "الأعضاء"), tab("settings", "الإعدادات"),
        h("button", {class: "tab", onclick: async () => { await api("POST", "/logout"); state.me = null; render(); }}, "تسجيل الخروج"))),
    h("main", {id: "main"}));
  if (state.tab === "members") renderMembers(); else renderSettings();
}

/* ---------- members list ---------- */
function renderMembers() {
  const main = document.getElementById("main");
  const search = h("input", {type: "search", placeholder: "بحث بالاسم أو الرقم", "aria-label": "بحث", value: state.q,
    oninput: debounce(event => { state.q = event.target.value; loadMembers(); }, 250)});
  const select = h("select", {"aria-label": "تصفية حسب الحالة", onchange: event => { state.status = event.target.value; loadMembers(); }},
    h("option", {value: ""}, "كل الحالات"), ...Object.entries(L.status).map(([k, v]) => h("option", {value: k, selected: state.status === k}, v)));
  main.replaceChildren(
    h("div", {class: "card"}, h("div", {class: "row grow"}, search, select,
      h("button", {class: "btn primary", onclick: () => openForm()}, "+ عضو جديد"))),
    h("div", {class: "card", id: "list"}));
  drawList();
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
async function loadMembers() {
  const params = new URLSearchParams({q: state.q, status: state.status});
  state.members = (await api("GET", "/members?" + params)).members;
  drawList();
  clearTimeout(state.timer);
  if (state.members.some(m => ["saving", "publishing"].includes(m.publication.state) || m.pdf.state === "building")) state.timer = setTimeout(() => loadMembers().catch(() => {}), 1500);
}
function drawList() {
  const box = document.getElementById("list");
  if (!box) return;
  if (!state.members.length) return box.replaceChildren(h("p", {class: "muted"}, "لا يوجد أعضاء."));
  box.replaceChildren(h("table", {},
    h("thead", {}, h("tr", {}, ...["", "الاسم", "الرقم", "الصلاحية", "النشر", ""].map(t => h("th", {}, t)))),
    h("tbody", {}, state.members.map(m => h("tr", {"data-id": m.id},
      h("td", {}, h("img", {class: "avatar", src: `${API}/members/${m.id}/photo`, alt: ""})),
      h("td", {class: "name", dir: "auto"}, m.fullName, h("div", {class: "muted", dir: "auto", style: "font-weight:400"}, m.role)),
      h("td", {}, m.memberNumber || "—"),
      h("td", {}, badge(m.status, L.status[m.status]), " ", h("span", {class: "muted"}, m.expiresAt)),
      h("td", {}, badge(m.publication.state, L.pub[m.publication.state])),
      h("td", {}, h("button", {class: "btn", onclick: () => openDetail(m.id)}, "فتح")))))));
}

/* ---------- create / edit ---------- */
function openForm(member) {
  const editing = !!member;
  const dialog = h("dialog");
  const msg = h("div");
  let photo = null;
  const preview = h("img", {class: "thumb", alt: "", src: editing ? `${API}/members/${member.id}/photo` : "", hidden: !editing});
  const requestId = crypto.randomUUID();
  const form = h("form", {onsubmit: async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    notify(msg, "warn", "جارٍ الحفظ…");
    try {
      const data = {fullName: form.fullName.value, role: form.role.value, expiresAt: form.expiresAt.value, memberNumber: form.memberNumber.value};
      if (photo) data.photo = photo;
      if (!editing && !photo) throw new Error("الصورة مطلوبة.");
      const out = editing ? await api("PUT", "/members/" + member.id, data) : await api("POST", "/members", {...data, requestId});
      dialog.close(); dialog.remove();
      await loadMembers();
      openDetail(out.member.id);
    } catch (error) { notify(msg, "err", error.message); button.disabled = false; }
  }},
  h("div", {class: "grid2"},
    h("label", {class: "field"}, "الاسم واللقب", h("input", {type: "text", name: "fullName", dir: "rtl", required: true, maxlength: 120, value: member?.fullName || ""})),
    h("label", {class: "field"}, "المنصب داخل الجمعية", h("input", {type: "text", name: "role", dir: "rtl", required: true, maxlength: 120, value: member?.role || ""})),
    h("label", {class: "field"}, "تاريخ الانتهاء", h("input", {type: "date", name: "expiresAt", required: true, value: member?.expiresAt || ""})),
    h("label", {class: "field"}, "رقم العضوية ", h("small", {}, "(اختياري، داخلي)"), h("input", {type: "text", name: "memberNumber", maxlength: 40, value: member?.memberNumber || ""}))),
  h("label", {class: "field"}, "الصورة", h("small", {}, "JPEG أو PNG أو WebP. تُقتطع تلقائياً عند العرض دون أي تشويه."),
    h("input", {type: "file", name: "photo", accept: "image/jpeg,image/png,image/webp", onchange: async event => {
      const file = event.target.files[0];
      if (!file) return;
      try { photo = await readPhoto(file); preview.src = photo; preview.hidden = false; } catch { notify(msg, "err", "الصورة غير مقروءة."); }
    }})), preview,
  h("div", {class: "actions"}, h("button", {class: "btn primary", type: "submit"}, editing ? "حفظ وإعادة النشر" : "إنشاء ونشر"),
    h("button", {class: "btn", type: "button", onclick: () => { dialog.close(); dialog.remove(); }}, "إلغاء")), msg);
  dialog.append(h("div", {class: "dlg-head"}, h("h2", {}, editing ? "تعديل بطاقة العضو" : "عضو جديد")), h("div", {class: "dlg-body"}, form));
  document.body.append(dialog);
  dialog.showModal();
}

/* ---------- member detail ---------- */
let detailTimer;
async function openDetail(id) {
  document.querySelectorAll("dialog[data-detail]").forEach(d => d.remove());
  clearTimeout(detailTimer);
  const dialog = h("dialog", {"data-detail": id});
  dialog.addEventListener("close", () => { clearTimeout(detailTimer); dialog.remove(); loadMembers().catch(() => {}); });
  document.body.append(dialog);
  dialog.showModal();
  const refresh = async () => {
    const {member} = await api("GET", "/members/" + id);
    if (!dialog.isConnected) return;
    drawDetail(dialog, member);
    clearTimeout(detailTimer);
    if (["saving", "publishing"].includes(member.publication.state) || member.pdf.state === "building") detailTimer = setTimeout(() => refresh().catch(() => {}), 1500);
  };
  dialog.refresh = refresh;
  await refresh();
}

function drawDetail(dialog, m) {
  const msg = h("div");
  const act = (label, fn, cls = "btn", disabled = false) => h("button", {class: cls, disabled, onclick: async event => {
    event.target.disabled = true;
    try { await fn(); await dialog.refresh(); } catch (error) { notify(msg, "err", error.message); event.target.disabled = false; }
  }}, label);
  const published = m.publication.state === "published" && m.verified;
  const download = (href, label) => published || href.endsWith("card.pdf") && m.pdf.state === "ready"
    ? h("a", {class: "btn", href}, label) : h("button", {class: "btn", disabled: true}, label);
  const pdfReady = m.pdf.state === "ready";
  const keepScroll = dialog.querySelector(".dlg-body")?.scrollTop || 0;

  dialog.replaceChildren(
    h("div", {class: "dlg-head"}, h("h2", {dir: "auto"}, m.fullName), h("button", {class: "btn", onclick: () => dialog.close()}, "إغلاق")),
    h("div", {class: "dlg-body"},
      h("div", {class: "row"}, h("img", {class: "thumb", src: `${API}/members/${m.id}/photo?${m.updatedAt}`, alt: ""}),
        h("div", {}, h("div", {dir: "auto"}, m.role), h("div", {class: "muted"}, "رقم " + (m.memberNumber || "—") + " · ينتهي في " + m.expiresAt),
          h("div", {class: "steps"}, badge(m.status, L.status[m.status]), badge(m.publication.state, L.pub[m.publication.state]), badge(m.pdf.state, L.pdf[m.pdf.state])))),
      m.publication.state === "failed" ? h("div", {class: "notice err", role: "alert"}, "تم حفظ البطاقة لكن النشر فشل : " + m.publication.error) : null,
      ["saving", "publishing"].includes(m.publication.state) ? h("div", {class: "notice warn", role: "status"}, L.pub[m.publication.state] + "… (قد يستغرق التحقق من الرابط العام دقيقة أو دقيقتين)") : null,
      m.pdf.state === "failed" ? h("div", {class: "notice err"}, "PDF : " + m.pdf.error) : null,
      m.pdf.state === "blocked" ? h("div", {class: "notice err"}, "لم يُنشأ PDF : " + m.pdf.issues.map(i => i.message).join(" ")) : null,
      (m.pdf.issues || []).filter(i => !i.blocking).map(i => h("div", {class: "notice warn"}, i.message)),
      h("div", {class: "card"}, h("h2", {}, "الرابط العام"), h("div", {class: "link"}, m.url),
        h("div", {class: "actions"},
          published ? h("a", {class: "btn primary", href: m.url, target: "_blank", rel: "noopener"}, "عرض البطاقة") : h("button", {class: "btn primary", disabled: true}, "عرض البطاقة"),
          act("نسخ الرابط", async () => { await navigator.clipboard.writeText(m.url); notify(msg, "ok", "تم نسخ الرابط."); }, "btn", !published),
          download(`${API}/members/${m.id}/qr.png`, "تنزيل رمز QR"),
          download(`${API}/members/${m.id}/card.pdf`, "تنزيل PDF")),
        msg),
      h("div", {class: "actions"},
        m.publication.state === "failed" ? act("إعادة محاولة النشر", () => api("POST", `/members/${m.id}/publish`), "btn primary") : null,
        act("تعديل", async () => openForm(m)),
        m.disabled ? act("إعادة التفعيل", () => api("POST", `/members/${m.id}/enable`)) : act("تعطيل", () => api("POST", `/members/${m.id}/disable`), "btn danger"),
        h("form", {class: "row", onsubmit: async event => {
          event.preventDefault();
          try { await api("POST", `/members/${m.id}/renew`, {expiresAt: event.target.date.value}); await dialog.refresh(); } catch (error) { notify(msg, "err", error.message); }
        }}, h("input", {type: "date", name: "date", required: true, "aria-label": "تاريخ الانتهاء الجديد", style: "width:auto"}), h("button", {class: "btn", type: "submit"}, "تجديد (نفس رمز QR)"))),
      printPanel(dialog, m)));
  dialog.querySelector(".dlg-body").scrollTop = keepScroll;
}

/* ---------- print configuration + preview ---------- */
function printForm(config, settings, onchange) {
  const fieldBoxes = {};
  const mk = (name, label, value) => h("label", {class: "field"}, label, h("input", {type: "number", name, min: 40, max: 300, step: "0.1", value, onchange}));
  const width = mk("widthMm", "العرض (ملم)", config.widthMm);
  const height = mk("heightMm", "الارتفاع (ملم)", config.heightMm);
  const orientation = h("select", {name: "orientation", onchange}, h("option", {value: "portrait", selected: config.orientation === "portrait"}, "عمودي"),
    h("option", {value: "landscape", selected: config.orientation === "landscape"}, "أفقي"));
  const list = h("div", {class: "fieldlist"}, PRINT_FIELDS.map(([key, label, pub]) => {
    const box = h("input", {type: "checkbox", checked: !!config.fields[key], onchange});
    fieldBoxes[key] = box;
    const online = pub === "always" || (pub && settings.publicFields[pub]);
    return h("label", {}, box, label, h("span", {class: "tag"}, online ? "مطبوع · ظاهر أيضاً على الإنترنت" : "مطبوع فقط"));
  }));
  const root = h("div", {}, h("div", {class: "grid2"}, width.parentNode ? width : width, height,
    h("label", {class: "field"}, "الاتجاه", orientation)), h("p", {class: "muted"}, "تحديد الحقل يطبعه على PDF دون أن يجعله عاماً. الحقول الظاهرة على الإنترنت تُضبط في الإعدادات."), list);
  root.read = () => ({widthMm: Number(width.querySelector("input").value), heightMm: Number(height.querySelector("input").value), orientation: orientation.value,
    fields: Object.fromEntries(Object.entries(fieldBoxes).map(([k, b]) => [k, b.checked]))});
  return root;
}
function previewPane(request) {
  const box = h("div", {class: "preview-box"});
  const notes = h("div");
  const wrap = h("div", {class: "preview-wrap"}, box);
  let counter = 0;
  const update = async () => {
    const mine = ++counter;
    try {
      const data = await request();
      if (mine !== counter) return;
      const px = mm => mm * 96 / 25.4;
      const scale = Math.min(1, 300 / px(data.widthMm), 420 / px(data.heightMm)) || 1;
      box.style.width = px(data.widthMm) * scale + "px";
      box.style.height = px(data.heightMm) * scale + "px";
      const frame = h("iframe", {src: API + "/print-preview/" + data.token, title: "معاينة", scrolling: "no", sandbox: "allow-scripts allow-same-origin",
        style: `width:${px(data.widthMm)}px;height:${px(data.heightMm)}px;transform:scale(${scale})`});
      box.replaceChildren(frame);
      const info = [h("div", {class: "muted"}, `المقاس ${data.widthMm} × ${data.heightMm} ملم · QR ${data.layout.qrMm ? data.layout.qrMm.toFixed(1) + " ملم" : "غير موجود"}`)];
      for (const issue of data.layout.issues) info.push(h("div", {class: "notice " + (issue.blocking ? "err" : "warn")}, issue.message));
      notes.replaceChildren(...info);
    } catch (error) { notify(notes, "err", error.message); }
  };
  return {node: h("div", {}, wrap, notes), update};
}
function printPanel(dialog, m) {
  const settings = state.settings || {publicFields: {}, printDefaults: {}};
  const effective = m.pdf.config || m.print || settings.printDefaults;
  const msg = h("div");
  const trigger = debounce(() => pane.update(), 300);
  const form = printForm(m.print || effective, settings, trigger);
  let pane;
  pane = previewPane(() => api("POST", "/print-preview", {memberId: m.id, config: form.read()}));
  pane.update();
  const run = (label, fn, cls = "btn") => h("button", {class: cls, onclick: async event => {
    event.target.disabled = true;
    try { await fn(); await dialog.refresh(); } catch (error) { notify(msg, "err", error.message); event.target.disabled = false; }
  }}, label);
  return h("div", {class: "card"}, h("h2", {}, "الطباعة (PDF)"),
    h("div", {class: "grid2"}, form, pane.node),
    h("div", {class: "actions"},
      run("حفظ لهذه البطاقة وإعادة إنشاء PDF", () => api("PUT", `/members/${m.id}/print`, {config: form.read()}), "btn primary"),
      run("استخدام الإعدادات الافتراضية", () => api("PUT", `/members/${m.id}/print`, {config: null})),
      run("إعادة إنشاء PDF", () => api("POST", `/members/${m.id}/pdf`)),
      h("button", {class: "btn", onclick: () => { const f = pane.node.querySelector("iframe"); if (f) { f.contentWindow.focus(); f.contentWindow.print(); } }}, "طباعة / PDF (المتصفح)")), msg,
    h("p", {class: "muted"}, "الطباعة عبر المتصفح : اختر «حفظ بصيغة PDF» والهوامش «بلا» والمقياس 100%."),
    h("p", {class: "muted"}, m.print ? "لهذه البطاقة إعداد خاص بها." : "تتبع هذه البطاقة الإعداد الافتراضي."));
}

/* ---------- settings ---------- */
async function loadSettings() {
  const data = await api("GET", "/settings");
  state.settings = data.settings;
  state.settingsPublication = data.publication;
  if (state.tab === "settings") renderSettings();
}
function renderSettings() {
  const main = document.getElementById("main");
  const s = state.settings;
  if (!s) return main.replaceChildren(h("p", {}, "جارٍ التحميل…"));
  const msg = h("div");
  const contactLabels = {phone: "الهاتف (+213…)", whatsapp: "واتساب", facebook: "فيسبوك (رابط الصفحة https)", facebookName: "اسم صفحة فيسبوك المعروض",
    instagram: "إنستغرام (رابط https)", email: "البريد الإلكتروني", maps: "رابط خرائط Google (https)", address: "عنوان المقر", hours: "أوقات الاستقبال (سطر لكل يوم)",
    nationalWebsite: "الموقع الوطني (https)", nationalPhones: "هواتف المكتب الوطني (رقم في كل سطر)", nationalEmail: "البريد الإلكتروني للمكتب الوطني"};
  const ltrKeys = ["phone", "whatsapp", "email", "facebook", "instagram", "maps", "nationalWebsite", "nationalEmail", "nationalPhones"];
  const multiline = ["hours", "nationalPhones"];
  const contacts = h("div", {class: "grid2"}, Object.keys(s.contacts).map(key => h("label", {class: "field"}, contactLabels[key] || key,
    multiline.includes(key)
      ? h("textarea", {name: key, rows: 3, dir: ltrKeys.includes(key) ? "ltr" : "auto", value: s.contacts[key]})
      : h("input", {type: "text", name: key, dir: ltrKeys.includes(key) ? "ltr" : "auto", value: s.contacts[key]}))));
  const pf = {photo: "الصورة", role: "المنصب", expiry: "تاريخ الانتهاء", memberNumber: "رقم العضوية"};
  const publicBoxes = {};
  const publicList = h("div", {class: "fieldlist"}, h("label", {}, h("input", {type: "checkbox", checked: true, disabled: true}), "الاسم الكامل", h("span", {class: "tag"}, "ظاهر دائماً")),
    Object.entries(pf).map(([k, label]) => { publicBoxes[k] = h("input", {type: "checkbox", checked: !!s.publicFields[k]}); return h("label", {}, publicBoxes[k], label, h("span", {class: "tag"}, "ظاهر على الإنترنت")); }));
  const printUI = printForm(s.printDefaults, s, () => {});
  const job = state.settingsPublication;
  main.replaceChildren(h("form", {onsubmit: async event => {
    event.preventDefault();
    try {
      const body = {contacts: Object.fromEntries([...contacts.querySelectorAll("input, textarea")].map(i => [i.name, i.value])),
        publicFields: Object.fromEntries(Object.entries(publicBoxes).map(([k, b]) => [k, b.checked])), printDefaults: printUI.read()};
      const out = await api("PUT", "/settings", body);
      state.settings = out.settings; state.settingsPublication = out.publication;
      notify(msg, "ok", "تم حفظ الإعدادات. تُعاد صفحات البطاقات العامة عند الحاجة.");
      pollSettings();
    } catch (error) { notify(msg, "err", error.message); }
  }},
  job ? h("div", {class: "notice " + (job.state === "failed" ? "err" : job.state === "published" ? "ok" : "warn")}, "نشر الإعدادات : " + L.pub[job.state] + (job.error ? " — " + job.error : "")) : null,
  h("div", {class: "card"}, h("h2", {}, "بيانات التواصل الرسمية للمكتب"), h("p", {class: "muted"}, "موحّدة : تظهر على كل البطاقات. الحقول الفارغة تُخفى."), contacts),
  h("div", {class: "card"}, h("h2", {}, "الحقول العامة للبطاقات"), h("p", {class: "muted"}, "هذه الحقول فقط تُنشر في صفحة البطاقة."), publicList),
  h("div", {class: "card"}, h("h2", {}, "الطباعة الافتراضية (للبطاقات الجديدة)"), printUI),
  h("button", {class: "btn primary", type: "submit"}, "حفظ الإعدادات"), msg));
}
function pollSettings() {
  setTimeout(async () => {
    const data = await api("GET", "/settings").catch(() => null);
    if (!data) return;
    state.settingsPublication = data.publication;
    if (state.tab === "settings") renderSettings();
    if (data.publication?.state === "publishing") pollSettings();
  }, 2000);
}

async function boot() {
  try { state.me = await api("GET", "/me"); } catch { state.me = null; }
  render();
  if (state.me) { state.settings = (await api("GET", "/settings")).settings; await loadMembers(); }
}
boot();
