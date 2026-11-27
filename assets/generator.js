"use strict";

const byId = id => document.getElementById(id);
const form = byId("generator");
const nameInput = byId("fullName");
const roleInput = byId("role");
const slugInput = byId("slug");
const photoInput = byId("photo");
const portrait = byId("portrait");
const status = byId("status");
const slugSeed = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).padStart(7, "0");
let slugEdited = false;
let previewObject = "";
let site;
let template;
let taken = new Set(["preview"]);

function preview() {
  const name = nameInput.value.trim();
  byId("preview-name").textContent = name || "اسم ولقب العضو";
  byId("preview-role").textContent = roleInput.value.trim() || "منصب العضو";
  if (!slugEdited) {
    const stem = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").slice(0, 55).replace(/^-|-$/g, "");
    slugInput.value = name ? (stem || "member") + "-" + slugSeed : "";
  }
  const slug = slugInput.value;
  slugInput.setCustomValidity(taken.has(slug) ? "هذا المعرّف مستخدم. اختر معرّفًا آخر." : "");
  byId("member-url").textContent = site && MemberPages.slugPattern.test(slug)
    ? new URL("members/" + slug + "/", site.baseUrl).href : "";
}

photoInput.addEventListener("change", () => {
  if (previewObject) URL.revokeObjectURL(previewObject);
  previewObject = "";
  const file = photoInput.files[0];
  const valid = file && ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 15 * 1024 * 1024;
  photoInput.setCustomValidity(file && !valid ? "اختر صورة JPEG أو PNG أو WebP بحجم لا يتجاوز 15 ميغابايت." : "");
  if (valid) previewObject = URL.createObjectURL(file);
  portrait.src = previewObject || new URL("assets/logo.jpg", siteRoot).href;
  portrait.classList.toggle("logo", !previewObject);
  status.textContent = "";
});

slugInput.addEventListener("input", () => {slugEdited = !!slugInput.value;});
form.addEventListener("input", preview);

Promise.all([
  readData("site"),
  readData("members"),
  fetch(new URL("templates/member.html", siteRoot)).then(response => {
    if (!response.ok) throw new Error("Missing template");
    return response.text();
  })
]).then(([configuration, members, html]) => {
  site = configuration;
  taken = new Set(["preview", ...members.map(member => member.slug)]);
  template = html;
  byId("export").disabled = false;
  preview();
}).catch(() => {status.textContent = "تعذّر تحميل سجل الأعضاء أو قالب البطاقة. أعد تحميل الصفحة.";});

async function memberPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const crop = Math.min(bitmap.width, bitmap.height);
  const canvas = element("canvas");
  canvas.width = canvas.height = Math.min(crop, 720);
  canvas.getContext("2d").drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2,
    crop, crop, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const jpeg = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .88));
  if (!jpeg) throw new Error("Photo conversion failed");
  return new Uint8Array(await jpeg.arrayBuffer());
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const fullName = nameInput.value.trim();
  const role = roleInput.value.trim();
  if (!fullName || !role) {
    status.textContent = "أدخل الاسم والمنصب.";
    return;
  }
  const slug = slugInput.value;
  const photo = "assets/members/" + slug + ".jpg";
  const member = {id:"member-" + crypto.randomUUID(), slug, fullName, role, photo, active:true};
  const file = photoInput.files[0];
  byId("export").disabled = true;
  try {
    const current = await readData("members");
    if (current.some(entry => entry.slug === slug) || slug === "preview") {
      taken.add(slug);
      preview();
      form.reportValidity();
      return;
    }
    const photos = await memberPhoto(file);
    const zip = fflate.zipSync({
      "data/members.json": fflate.strToU8(JSON.stringify([...current, member], null, 2) + "\n"),
      ["members/" + slug + "/index.html"]: fflate.strToU8(MemberPages.renderMember(template, member, site.baseUrl)),
      [photo]: photos
    });
    const object = URL.createObjectURL(new Blob([zip], {type:"application/zip"}));
    download(object, slug + ".zip");
    setTimeout(() => URL.revokeObjectURL(object), 1000);
    byId("published-url").value = new URL("members/" + slug + "/", site.baseUrl).href;
    status.textContent = "تم تجهيز الملفات. فكّ ضغطها وارفع محتوياتها إلى المستودع مع الحفاظ على المسارات.";
  } catch {
    status.textContent = "تعذّر تصدير البطاقة. تحقّق من الصورة واتصالك ثم أعد المحاولة.";
  } finally {
    byId("export").disabled = false;
  }
});

byId("published-qr").addEventListener("click", async () => {
  const qrStatus = byId("qr-status");
  const button = byId("published-qr");
  byId("qr-panel").hidden = true;
  button.disabled = true;
  try {
    const url = new URL(byId("published-url").value.trim());
    const base = new URL(site.baseUrl);
    const pattern = /^members\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/;
    const match = url.pathname.startsWith(base.pathname) && pattern.exec(url.pathname.slice(base.pathname.length));
    if (url.origin !== base.origin || !match || url.search || url.hash) throw new Error("Invalid member URL");
    const members = await readData("members");
    if (match[1] !== "preview" && !members.some(member => member.slug === match[1] && member.active === true)) {
      throw new Error("Inactive member");
    }
    const response = await fetch(new URL("members/" + match[1] + "/", siteRoot), {cache:"no-cache"});
    if (!response.ok) throw new Error("Unpublished member");
    renderQR(byId("qr-image"), url.href);
    byId("qr-download").dataset.slug = match[1];
    byId("qr-panel").hidden = false;
    qrStatus.textContent = "";
  } catch {
    qrStatus.textContent = "تحقّق من الرابط ومن اكتمال نشر البطاقة على GitHub Pages.";
  } finally {
    button.disabled = false;
  }
});
byId("published-url").addEventListener("input", () => {
  byId("qr-panel").hidden = true;
  byId("qr-status").textContent = "";
});
byId("qr-download").addEventListener("click", event => {
  download(byId("qr-image").toDataURL("image/png"), event.currentTarget.dataset.slug + "-qr.png");
});
