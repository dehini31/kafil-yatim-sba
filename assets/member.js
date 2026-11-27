"use strict";

const byId = id => document.getElementById(id);
const slug = document.body.dataset.member;
const isDemo = document.body.dataset.demo === "true";
const url = new URL(location.href);
url.hash = "";
url.search = "";
url.pathname = url.pathname.replace(/index\.html$/, "");
const status = byId("status");

async function copyLink() {
  try {
    await navigator.clipboard.writeText(url.href);
    status.textContent = "تم نسخ رابط البطاقة.";
  } catch {
    const field = byId("share-url");
    field.value = url.href;
    field.hidden = false;
    field.focus();
    field.select();
    status.textContent = "انسخ الرابط المحدد.";
  }
}

function showSharing() {
  const qrButton = byId("qr");
  const panel = byId("qr-panel");
  const canvas = byId("qr-image");
  byId("sharing").hidden = false;
  byId("share").hidden = typeof navigator.share !== "function";
  byId("share").addEventListener("click", async () => {
    try {
      await navigator.share({title:document.title, url:url.href});
    } catch (error) {
      if (error.name !== "AbortError") await copyLink();
    }
  });
  byId("copy").addEventListener("click", copyLink);
  qrButton.addEventListener("click", () => {
    if (panel.hidden) renderQR(canvas, url.href);
    panel.hidden = !panel.hidden;
    qrButton.setAttribute("aria-expanded", String(!panel.hidden));
  });
  byId("qr-download").addEventListener("click", () => download(canvas.toDataURL("image/png"), slug + "-qr.png"));
}

if (isDemo) {
  byId("demo-note").hidden = false;
  showSharing();
} else {
  readData("members").then(members => {
    if (members.some(member => member.slug === slug && member.active === true)) showSharing();
    else {
      byId("identity").hidden = true;
      byId("unavailable").hidden = false;
    }
  }).catch(() => {
    status.textContent = "تعذّر التحقق من حالة البطاقة. أعد تحميل الصفحة.";
    byId("sharing").hidden = false;
    byId("sharing").querySelector(".actions").hidden = true;
  });
}
