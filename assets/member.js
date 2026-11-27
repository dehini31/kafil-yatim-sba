"use strict";

const byId = id => document.getElementById(id);
const slug = document.body.dataset.member;
const isDemo = document.body.dataset.demo === "true";
const url = new URL(location.href);
url.hash = "";
url.search = "";
url.pathname = url.pathname.replace(/index\.html$/, "");
const status = byId("status");
const stateLabels = {active: "بطاقة سارية", expired: "بطاقة منتهية الصلاحية", disabled: "بطاقة غير سارية"};

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

// Validity is computed on the visitor's side from the public registry, so a card
// expires on its date without any republication. Cards stay reachable when expired or disabled.
function setValidity(entry) {
  const today = new Intl.DateTimeFormat("en-CA", {timeZone:"Africa/Algiers"}).format(new Date());
  const state = !entry.active ? "disabled" : entry.expiresAt && entry.expiresAt < today ? "expired" : "active";
  const badge = byId("validity");
  badge.dataset.state = state;
  badge.textContent = stateLabels[state];
  document.body.dataset.state = state;
}

if (isDemo) {
  byId("demo-note").hidden = false;
  showSharing();
} else {
  showSharing();
  setValidity({active: document.body.dataset.active === "true", expiresAt: document.body.dataset.expires});
  readData("members").then(members => {
    const entry = members.find(member => member.slug === slug);
    if (entry) setValidity(entry);
    else {
      byId("identity").hidden = true;
      byId("unavailable").hidden = false;
      byId("sharing").hidden = true;
    }
  }).catch(() => {});
}
